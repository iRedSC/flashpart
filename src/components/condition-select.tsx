import { CONDITION_OPTIONS, type Condition } from "../../convex/listingTypes";

export function ConditionSelect({ value, onChange, disabled }: {
  value?: Condition;
  onChange: (value: Condition) => void;
  disabled?: boolean;
}) {
  return (
    <select
      aria-label="Condition"
      className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
      value={value ?? ""}
      disabled={disabled}
      onChange={(event) => {
        const option = CONDITION_OPTIONS.find(option => option.value === event.target.value);
        if (option) onChange(option.value);
      }}
    >
      <option value="" disabled>Select condition</option>
      {CONDITION_OPTIONS.map(option => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  );
}
