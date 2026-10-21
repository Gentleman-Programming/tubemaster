export type ClassDictionary = Record<string, boolean | null | undefined>;
export type ClassValue = string | number | boolean | null | undefined | ClassDictionary | ClassValue[];

/** Joins truthy class names; supports strings, arrays and `{ className: condition }` objects. */
export function cn(...values: ClassValue[]): string {
  const classes: string[] = [];
  const collect = (value: ClassValue) => {
    if (!value || value === true) return;
    if (Array.isArray(value)) {
      value.forEach(collect);
    } else if (typeof value === "object") {
      for (const [name, enabled] of Object.entries(value)) if (enabled) classes.push(name);
    } else {
      const name = String(value).trim();
      if (name) classes.push(name);
    }
  };
  values.forEach(collect);
  return classes.join(" ");
}
