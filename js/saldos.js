import { supabase } from "./supabaseClient.js";

export async function obtenerResumenSaldosWeb(fechaCorte) {
  const hoy = new Date().toISOString().split("T")[0];
  const fecha = fechaCorte || hoy;

  // 1. Obtener tasa vigente hasta la fecha de corte
  const { data: tasasRes, error: errTasas } = await supabase
    .from("tasas_cambio")
    .select("usd, eur, vef")
    .lte("fecha", fecha)
    .order("fecha", { ascending: false })
    .limit(1);

  if (errTasas) throw errTasas;

  const tasas = { USD: 1, EUR: 1, VEF: 1, VES: 1, COP: 1 };
  if (tasasRes && tasasRes.length > 0) {
    tasas.USD = parseFloat(tasasRes[0].usd) || 1;
    tasas.EUR = parseFloat(tasasRes[0].eur) || 1;
    tasas.VEF = parseFloat(tasasRes[0].vef) || 1;
    tasas.VES = parseFloat(tasasRes[0].vef) || 1;
  }

  // 2. Obtener cuentas activas
  const { data: cuentas, error: errCuentas } = await supabase
    .from("cuentas")
    .select("*")
    .order("nombre", { ascending: true });

  if (errCuentas) throw errCuentas;

  const cuentasActivas = cuentas.filter(
    (c) => c.estado === "Activo" || c.estado === "Activa",
  );

  // 3. Llamar a la función RPC calcular_saldos_hasta en PostgreSQL
  const { data: sumasSQL, error: errRpc } = await supabase.rpc(
    "calcular_saldos_hasta",
    { fecha_corte: fecha },
  );

  if (errRpc) throw errRpc;

  const saldosPorNombre = {};
  if (Array.isArray(sumasSQL)) {
    sumasSQL.forEach((row) => {
      if (row.cuenta) saldosPorNombre[row.cuenta] = parseFloat(row.total) || 0;
    });
  }

  // 4. Armar resultado
  return cuentasActivas.map((c) => {
    const moneda = (c.moneda_codigo || "COP").toUpperCase();
    const saldoOrig = saldosPorNombre[c.nombre] || 0;
    const tasa = tasas[moneda] || 1;

    return {
      institucion: c.institucion || "",
      tipo: c.tipo_cuenta || "",
      nombre: c.nombre,
      moneda,
      saldoOriginal: saldoOrig,
      saldoCOP: saldoOrig * tasa,
    };
  });
}
