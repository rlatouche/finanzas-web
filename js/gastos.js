import { supabase } from "./supabaseClient.js";

export async function obtenerDatosGastosWeb(desde, hasta) {
  let query = supabase
    .from("transacciones")
    .select("categoria, subcategoria, beneficiario, monto_real, moneda")
    .lt("monto_real", 0)
    .or("tipo.neq.Transferencia,tipo.is.null")
    .neq("categoria", "Transferencia")
    .limit(50000);

  if (desde) query = query.gte("fecha", desde);
  if (hasta) query = query.lte("fecha", hasta);

  const { data, error } = await query;
  if (error) throw error;

  const gastos = [];
  const categoriasSet = new Set();

  (data || []).forEach((f) => {
    const cat = (f.categoria || "Sin categoría").trim();
    gastos.push({
      categoria: cat,
      subcategoria: (f.subcategoria || "General").trim(),
      beneficiario: (f.beneficiario || "[Sin beneficiario]").trim(),
      monto: parseFloat(f.monto_real) || 0,
      moneda: f.moneda || "COP",
    });

    if (f.categoria) {
      categoriasSet.add(cat);
    }
  });

  return {
    gastos,
    categorias: Array.from(categoriasSet).sort(),
  };
}
