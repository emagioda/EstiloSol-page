type FinancialAttentionFlagProps = {
  code?: string;
  className?: string;
};

export default function FinancialAttentionFlag({
  code,
  className = "",
}: FinancialAttentionFlagProps) {
  if (!code) return null;

  return (
    <div
      className={`inline-flex max-w-full flex-col items-start rounded-lg border border-rose-300/70 bg-rose-100 px-2 py-1 text-left text-rose-950 ${className}`}
      role="status"
      aria-label="Atención financiera"
    >
      <span className="text-[10px] font-black">⚠ Requiere atención financiera</span>
      <span className="max-w-full break-all font-mono text-[9px] font-bold">{code}</span>
    </div>
  );
}
