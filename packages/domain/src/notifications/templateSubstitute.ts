export type SlotValue = string | number | boolean | null | undefined;

export type Slots = Record<string, SlotValue>;

const TOKEN = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;

export function substitute(template: string, slots: Slots): string {
  return template.replace(TOKEN, (_, name: string) => {
    const v = slots[name];
    if (v === null || v === undefined) return '';
    return String(v);
  });
}
