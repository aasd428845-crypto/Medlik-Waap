import { AlertCircle } from 'lucide-react';

export function ErrorMessage({ message }: { message: string }) {
  return (
    <div className="rounded-md bg-destructive/10 p-4 border border-destructive/20 my-4">
      <div className="flex items-center">
        <AlertCircle className="h-5 w-5 text-destructive ml-2 shrink-0" />
        <h3 className="text-sm font-medium text-destructive">{message}</h3>
      </div>
    </div>
  );
}
