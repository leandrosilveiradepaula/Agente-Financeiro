import { Loader2 } from "lucide-react";

type LoadingStateProps = {
  message: string;
};

export function LoadingState({ message }: LoadingStateProps) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-800">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      {message}
    </div>
  );
}
