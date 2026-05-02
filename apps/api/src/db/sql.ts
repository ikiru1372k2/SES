export interface SqlFragment {
  text: string;
  values: unknown[];
}

export function sql(strings: TemplateStringsArray, ...values: unknown[]): SqlFragment {
  let text = '';
  const flat: unknown[] = [];
  for (let i = 0; i < strings.length; i += 1) {
    text += strings[i];
    if (i < values.length) {
      const v = values[i];
      if (isFragment(v)) {
        const offset = flat.length;
        text += v.text.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + offset}`);
        flat.push(...v.values);
      } else {
        flat.push(v);
        text += `$${flat.length}`;
      }
    }
  }
  return { text, values: flat };
}

function isFragment(v: unknown): v is SqlFragment {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as SqlFragment).text === 'string' &&
    Array.isArray((v as SqlFragment).values)
  );
}

export function raw(text: string): SqlFragment {
  return { text, values: [] };
}

export function join(parts: SqlFragment[], separator: string): SqlFragment {
  if (parts.length === 0) return raw('');
  let text = '';
  const values: unknown[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    if (i > 0) text += separator;
    const part = parts[i]!;
    const offset = values.length;
    text += part.text.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + offset}`);
    values.push(...part.values);
  }
  return { text, values };
}
