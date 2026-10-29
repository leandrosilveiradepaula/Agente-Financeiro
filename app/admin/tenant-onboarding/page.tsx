"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Member={
  user_id:string;name:string;user_profile:string;is_active:boolean;
};
type ApiResult={
  success?:boolean;error?:string;
  organization_id?:string;members?:Member[];
};

export default function TenantOperatorPage(){
  const [name,setName]=useState("");
  const [confirm,setConfirm]=useState("");
  const [memberId,setMemberId]=useState("");
  const [organizationId,setOrganizationId]=useState<string|null>(null);
  const [members,setMembers]=useState<Member[]>([]);
  const [error,setError]=useState("");
  const [status,setStatus]=useState("");
  const [busy,setBusy]=useState(false);
  const [sessionReady,setSessionReady]=useState(false);

  async function refresh(){
    const [session,membersResponse]=await Promise.all([
      fetch("/api/auth/session",{cache:"no-store"}),
      fetch("/api/admin/tenant/members",{cache:"no-store"})
    ]);
    if(session.ok){
      const doc=await session.json() as {user?:{organizationId?:string|null}};
      setOrganizationId(doc.user?.organizationId??null);
      setSessionReady(true);
    }
    if(membersResponse.ok){
      const doc=await membersResponse.json() as ApiResult;
      setMembers(doc.members??[]);
    }
  }
  useEffect(()=>{void refresh();},[]);

  async function submit(url:string,payload:Record<string,string>){
    setError("");setStatus("");setBusy(true);
    try{
      const response=await fetch(url,{
        method:"POST",cache:"no-store",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(payload)
      });
      const json=await response.json() as ApiResult;
      if(!response.ok||!json.success){
        throw Error(json.error??"Operação não autorizada ou indisponível");
      }
      setStatus(url.endsWith("/bootstrap")
        ? "Organização criada pelo operador. Nenhum dado histórico ou conector financeiro foi atribuído."
        : "Vínculo de usuário registrado. Nenhum acesso financeiro foi concedido automaticamente.");
      await refresh();
    }catch(e){
      setError(e instanceof Error?e.message:"Operação indisponível.");
    }finally{setBusy(false);}
  }

  return(
    <main className="mx-auto max-w-5xl space-y-5 px-5 py-8 text-ink">
      <Link href="/admin/runs" className="text-sm font-semibold text-lake underline">
        Voltar ao histórico
      </Link>
      <h1 className="text-3xl font-semibold">Organizações e usuários autorizados</h1>
      <p className="text-sm text-steel">
        Identidade e membros são gerenciados separadamente dos conectores
        financeiros. Não existe organização padrão ou migração automática
        de execuções legadas.
      </p>
      {error&&<p role="alert" className="rounded-md border border-rose-200 p-3">{error}</p>}
      {status&&<p role="status" className="rounded-md border border-green-200 p-3">{status}</p>}
      <section className="rounded-lg border bg-white p-5 space-y-3">
        <h2 className="text-xl font-semibold">Identidade atual</h2>
        <p className="text-sm">Organização: <span className="font-mono">{organizationId??"Não selecionada"}</span></p>
      </section>
      {sessionReady&&!organizationId&&(
        <form className="rounded-lg border bg-white p-5 space-y-3"
          onSubmit={(e)=>{e.preventDefault();void submit("/api/admin/tenant/bootstrap",{
            display_name:name,confirm
          });}}>
          <h2 className="text-xl font-semibold">Criar a primeira organização</h2>
          <p className="text-sm text-steel">
            Esta ação é única e exige que o administrador esteja
            previamente designado como operador inicial no servidor.
          </p>
          <label className="block text-sm font-semibold" htmlFor="org-name">Nome da organização</label>
          <input id="org-name" value={name} maxLength={120} required
            onChange={e=>setName(e.target.value)}
            className="w-full rounded-md border p-3"/>
          <label className="block text-sm font-semibold" htmlFor="org-confirm">
            Digite CREATE-INITIAL-ORGANIZATION para confirmar
          </label>
          <input id="org-confirm" value={confirm}
            onChange={e=>setConfirm(e.target.value)}
            className="w-full rounded-md border p-3" required/>
          <button type="submit" disabled={busy||confirm!=="CREATE-INITIAL-ORGANIZATION"||
            name.trim()!==name||name.length<3||name.length>120}
            className="rounded-md bg-lake px-4 py-2 font-semibold text-white disabled:opacity-50">
            Criar organização
          </button>
        </form>
      )}
      {organizationId&&(
        <section className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="text-xl font-semibold">Membros do tenant</h2>
          <p className="text-sm text-steel">
            Selecione um usuário existente e ativo no cadastro administrativo.
            O vínculo não permite aprovação de SQL sem as permissões
            independentes do perfil.
          </p>
          <form className="space-y-3" onSubmit={e=>{e.preventDefault();void submit(
            "/api/admin/tenant/members",{user_id:memberId}
          );}}>
            <label htmlFor="member-id" className="block text-sm font-semibold">
              ID do usuário existente
            </label>
            <input id="member-id" value={memberId} onChange={e=>setMemberId(e.target.value)}
              className="w-full rounded-md border p-3 font-mono" required/>
            <button type="submit" disabled={busy}
              className="rounded-md border px-4 py-2 font-semibold disabled:opacity-50">
              Adicionar membro
            </button>
          </form>
          <div className="space-y-2">
            {members.map(m=>(
              <div key={m.user_id} className="border-t py-2 text-sm">
                <strong>{m.name}</strong> ({m.user_profile}) — {m.is_active?"Ativo":"Inativo"}
                <div className="font-mono text-xs text-steel">{m.user_id}</div>
              </div>
            ))}
          </div>
          <Link href="/admin/users" className="text-sm text-lake underline">
            Abrir cadastro de usuários
          </Link>
        </section>
      )}
      <p className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm">
        Nenhuma dessas ações ativa o LangGraph, altera o n8n oficial,
        habilita execução SQL ou atribui acesso ao lakehouse.
      </p>
    </main>
  );
}
