import { describe, expect, it } from "vitest";
import { validateWatsonSql } from "@/lib/sql-validation";

describe("validateWatsonSql", () => {
  it("accepts a safe SELECT query", () => {
    expect(
      validateWatsonSql("SELECT * FROM dev_lakehouse.main_gold.resultado LIMIT 10")
    ).toBeNull();
  });

  it("accepts a safe WITH query", () => {
    expect(
      validateWatsonSql(
        "WITH base AS (SELECT * FROM dev_lakehouse.main_gold.resultado) SELECT * FROM base LIMIT 10"
      )
    ).toBeNull();
  });

  it("rejects empty SQL", () => {
    expect(validateWatsonSql("   ")).toBe("SQL nao pode estar vazia.");
  });

  it("rejects destructive commands", () => {
    expect(validateWatsonSql("DELETE FROM dev_lakehouse.main_gold.resultado LIMIT 10")).toBe(
      "SQL nao pode conter comando destrutivo: DELETE."
    );
  });

  it("requires SELECT or WITH", () => {
    expect(validateWatsonSql("SHOW TABLES FROM dev_lakehouse.main_gold LIMIT 10")).toBe(
      "SQL deve comecar com SELECT ou WITH."
    );
  });

  it("requires the approved schema", () => {
    expect(validateWatsonSql("SELECT * FROM outro_schema.resultado LIMIT 10")).toBe(
      "SQL deve conter dev_lakehouse.main_gold."
    );
  });

  it("requires LIMIT", () => {
    expect(validateWatsonSql("SELECT * FROM dev_lakehouse.main_gold.resultado")).toBe(
      "SQL deve conter LIMIT."
    );
  });
});
