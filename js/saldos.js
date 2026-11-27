import { supabase } from "./supabaseClient.js";
import {
  obtenerMonedasWeb,
  obtenerTasasVigentesMapa,
  formatearMontoDinamico,
} from "./monedas.js";

export async function obtenerResumenSaldosWeb(fechaCorte) {
  const hoy = new Date().toISOString().split("T")[0];
  const fecha = fechaCorte || hoy;

  // 1. Obtener catálogo de monedas (activas e inactivas para formatear cuentas históricas) y tasas vigentes
  const [listaMonedas, { tasas, fecha: fechaTasa }] = await Promise.all([
    obtenerMonedasWeb(false),
    obtenerTasasVigentesMapa(fechaCorte || null),
  ]);

  // Crear diccionario rápido por código: { COP: { simbolo: '$', decimales: 2 }, ... }
  const mapaMonedas = Object.fromEntries(
    listaMonedas.map((m) => [m.codigo.toUpperCase(), m]),
  );

  // 2. Al recorrer cada cuenta para convertir su saldo a COP:
  // Antes: const tasa = moneda === 'USD' ? tasas.usd : ...
  // Ahora (100% dinámico para cualquier divisa):
  const codMoneda = (cuenta.moneda || "COP").toUpperCase();
  const tasaACOP = codMoneda === "COP" ? 1 : tasas[codMoneda] || 0;
  const saldoEnCOP = saldoOriginal * tasaACOP;

  // 3. Para mostrar el saldo formateado en la moneda original de la cuenta:
  const textoSaldoOriginal = formatearMontoDinamico(
    saldoOriginal,
    codMoneda,
    mapaMonedas,
  );

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
