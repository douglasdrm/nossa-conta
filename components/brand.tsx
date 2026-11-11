export default function Brand({ stacked = false }: { stacked?: boolean }) {
  return (
    <span className={stacked ? "nc-brand nc-brand-stacked" : "nc-brand"}>
      <img
        src="/brand/symbol.svg?v=2"
        width={42}
        height={36}
        alt=""
        aria-hidden="true"
      />
      <span className="nc-brand-name">nossa conta</span>
    </span>
  );
}
