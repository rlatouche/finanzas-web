import { supabase } from "./supabaseClient.js";
import {
  obtenerMonedasWeb,
  obtenerTasasVigentesMapa,
  formatearMontoDinamico,
} from "./monedas.js";

export async function obtenerResumenSaldosWeb(fechaCorte) {
  const hoy = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Bogota",
  });
  const fecha = fechaCorte || hoy;

  // 1. Obtener catálogo de monedas y tasas vigentes hasta la fecha de corte
  const [listaMonedas, { tasas }] = await Promise.all([
    obtenerMonedasWeb(false),
    obtenerTasasVigentesMapa(fecha),
  ]);

  const mapaMonedas = Object.fromEntries(
    listaMonedas.map((m) => [m.codigo.toUpperCase(), m]),
  );

  // Compatibilidad con registros históricos en VEF
  if (tasas.VES && !tasas.VEF) {
    tasas.VEF = tasas.VES;
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
    const tasa = moneda === "COP" ? 1 : tasas[moneda] || 1;

    return {
      institucion: c.institucion || "",
      tipo: c.tipo_cuenta || "",
      nombre: c.nombre,
      moneda,
      saldoOriginal: saldoOrig,
      saldoOriginalFormateado: formatearMontoDinamico(
        saldoOrig,
        moneda,
        mapaMonedas,
      ),
      saldoCOP: saldoOrig * tasa,
    };
  });
}
