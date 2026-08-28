import { saveItem } from './actions';

// One editable line. Deliberately a plain form post per row, no client JavaScript:
// the rest of the portal is server-rendered and a glossary edit is a one-off action,
// not something worth a client bundle for.
//
// Three inputs, in the order a person decides them:
//   Alias     picked from the aliases that already exist, so a variant MERGES instead
//             of quietly becoming a new product. Typing a new name is allowed but is
//             the exception: it creates a new product.
//   Category  a dropdown, never free text. Free text is how "Valenitne Menu" got into
//             the CSV and stayed there.
//   Occasion  optional tag. Rakhi, Christmas, Valentine, Friendship Day. A Rakhi cookie
//             tin is category Cookies and occasion Rakhi, so it counts in both views.
export interface ItemRowProps {
  itemName: string;
  alias?: string | null;
  category?: string | null;
  occasion?: string | null;
  shelfLife?: string | null;
  /** Context shown to the left so the decision can be made without leaving the row. */
  context?: React.ReactNode;
  aliases: string[];
  categories: string[];
  occasions: string[];
  back: string;
}

export default function ItemRow(p: ItemRowProps) {
  return (
    <tr>
      <td style={{ minWidth: 220 }}>
        <div style={{ fontWeight: 600 }}>{p.itemName}</div>
        {p.context ? <div className="muted" style={{ fontSize: 11.5 }}>{p.context}</div> : null}
      </td>
      <td colSpan={4}>
        <form action={saveItem} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="hidden" name="item_name" value={p.itemName} />
          <input type="hidden" name="back" value={p.back} />

          <input name="alias" list="cc-aliases" defaultValue={p.alias ?? p.itemName}
                 placeholder="Alias name" style={{ minWidth: 230 }} required />

          <select name="category" defaultValue={p.category ?? ''} required style={{ minWidth: 130 }}>
            <option value="" disabled>Category</option>
            {p.categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          <select name="occasion" defaultValue={p.occasion ?? ''} style={{ minWidth: 120 }}>
            <option value="">No occasion</option>
            {p.occasions.map(o => <option key={o} value={o}>{o}</option>)}
          </select>

          <input name="shelf_life" defaultValue={p.shelfLife ?? ''} placeholder="Shelf life"
                 style={{ width: 100 }} />

          <button className="btn btn-primary smallbtn" type="submit">Save</button>
        </form>
      </td>
    </tr>
  );
}
