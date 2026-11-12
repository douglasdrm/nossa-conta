export default function Brand({
  stacked = false,
  variant = "green",
}: {
  stacked?: boolean;
  variant?: "green" | "white";
}) {
  return (
    <span
      className={[
        "nc-brand",
        stacked && "nc-brand-stacked",
        variant === "white" && "nc-brand-white",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <img
        src={
          variant === "white"
            ? "/brand/symbol-white.svg?v=2"
            : "/brand/symbol.svg?v=2"
        }
        width={42}
        height={36}
        alt=""
        aria-hidden="true"
      />
      <span className="nc-brand-name">nossa conta</span>
    </span>
  );
}
