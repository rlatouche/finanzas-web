const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Faltan variables de entorno SUPABASE_URL o SUPABASE_KEY.');
  process.exit(1);
}

const headersSupabase = {
  apikey: supabaseKey,
  Authorization: `Bearer ${supabaseKey}`,
  'Content-Type': 'application/json',
  Prefer: 'resolution=merge-duplicates,return=minimal'
};

// Fecha actual en zona horaria de Bogotá (YYYY-MM-DD)
const fechaHoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

async function actualizarTasas() {
  console.log(`🔄 Iniciando sincronización de tasas para: ${fechaHoy}`);

  // 1. Obtener dinámicamente las monedas activas desde Supabase
  const resMon = await fetch(
    `${supabaseUrl}/rest/v1/monedas?select=codigo,es_base&activa=eq.true`,
    { headers: headersSupabase }
  );
  if (!resMon.ok) {
    throw new Error(`Error leyendo catálogo de monedas (${resMon.status}): ${await resMon.text()}`);
  }

  const monedasDB = await resMon.json();
  const monedasActivas = (monedasDB || [])
    .filter(m => !m.es_base)
    .map(m => m.codigo.toUpperCase());

  console.log(`📋 Monedas activas a consultar: ${monedasActivas.join(', ')}`);

  // 2. Consultar API pública de tasas base COP (open.er-api.com)
  const resp = await fetch('https://open.er-api.com/v6/latest/COP');
  if (!resp.ok) throw new Error(`Error HTTP ${resp.status} al consultar API de tasas`);

  const json = await resp.json();
  if (json.result !== 'success' || !json.rates) {
    throw new Error('Respuesta inválida de la API de tasas de cambio.');
  }

  // 3. Preparar registros para la tabla vertical (tasa_monedas)
  const filasVerticales = [
    { fecha: fechaHoy, moneda_codigo: 'COP', tasa_a_cop: 1 }
  ];

  const tasasMapa = {};

  for (const codigo of monedasActivas) {
    const rateDesdeCOP = json.rates[codigo];

    if (rateDesdeCOP && rateDesdeCOP > 0) {
      const tasaACOP = Number((1 / rateDesdeCOP).toFixed(6));
      tasasMapa[codigo] = tasaACOP;
      filasVerticales.push({
        fecha: fechaHoy,
        moneda_codigo: codigo,
        tasa_a_cop: tasaACOP
      });
    } else {
      console.warn(`⚠️ No se encontró tasa en la API para ${codigo}`);
    }
  }

  // 4. Upsert en la tabla vertical tasa_monedas
  const resVert = await fetch(
    `${supabaseUrl}/rest/v1/tasa_monedas?on_conflict=fecha,moneda_codigo`,
    {
      method: 'POST',
      headers: headersSupabase,
      body: JSON.stringify(filasVerticales)
    }
  );
  if (!resVert.ok) {
    throw new Error(`Error guardando en tasa_monedas (${resVert.status}): ${await resVert.text()}`);
  }
  console.log('✅ Tabla vertical tasa_monedas actualizada:', tasasMapa);

  // 5. Compatibilidad temporal con tabla legacy tasas_cambio
  if (tasasMapa.USD && tasasMapa.EUR && tasasMapa.VES) {
    const resLegacy = await fetch(
      `${supabaseUrl}/rest/v1/tasas_cambio?on_conflict=fecha`,
      {
        method: 'POST',
        headers: headersSupabase,
        body: JSON.stringify({
          fecha: fechaHoy,
          usd: tasasMapa.USD,
          eur: tasasMapa.EUR,
          vef: tasasMapa.VES
        })
      }
    );
    if (!resLegacy.ok) {
      console.warn(`⚠️ Aviso actualizando tabla legacy tasas_cambio: ${await resLegacy.text()}`);
    } else {
      console.log('✅ Tabla legacy tasas_cambio sincronizada.');
    }
  }
}

actualizarTasas().catch(err => {
  console.error('❌ Fallo en actualizarTasas:', err);
  process.exit(1);
});
