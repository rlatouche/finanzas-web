const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const APP_EMAIL = process.env.APP_EMAIL;
const APP_PASSWORD = process.env.APP_PASSWORD;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !APP_EMAIL || !APP_PASSWORD) {
  throw new Error('Faltan variables de entorno (SUPABASE_URL, SUPABASE_ANON_KEY, APP_EMAIL o APP_PASSWORD).');
}

async function iniciarSesionSupabase() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: APP_EMAIL,
      password: APP_PASSWORD
    })
  });

  if (!res.ok) {
    const detalle = await res.text();
    throw new Error(`Error de autenticación en Supabase (${res.status}): ${detalle}`);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error('No se recibió access_token tras iniciar sesión.');
  }

  return data.access_token;
}

async function obtenerTasasHoy() {
  const res = await fetch('https://open.er-api.com/v6/latest/COP');
  if (!res.ok) throw new Error(`Error consultando tasas: ${res.status}`);
  const data = await res.json();

  if (data.result !== 'success' || !data.rates) {
    throw new Error('Respuesta inválida del proveedor de tasas.');
  }

  // Invertimos (1 / tasa) para obtener cuántos COP vale 1 USD, 1 EUR y 1 VES
  const usd = Number((1 / data.rates.USD).toFixed(4));
  const eur = Number((1 / data.rates.EUR).toFixed(4));
  const vef = Number((1 / data.rates.VES).toFixed(4));

  return { usd, eur, vef };
}

async function main() {
  // 1. Autenticar con usuario y contraseña (privilegios mínimos vía RLS)
  const accessToken = await iniciarSesionSupabase();

  const headersSupabase = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates'
  };

  // Fecha actual en zona horaria de Bogotá (UTC-5)
  const hoyBogota = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota'
  }).format(new Date());

  // 2. Consultar última fecha en tasas_cambio
  const resUltima = await fetch(
    `${SUPABASE_URL}/rest/v1/tasas_cambio?select=fecha&order=fecha.desc&limit=1`,
    { headers: headersSupabase }
  );
  if (!resUltima.ok) throw new Error(await resUltima.text());
  const ultimaData = await resUltima.json();

  let fechaInicio = new Date(`${hoyBogota}T00:00:00Z`);
  if (Array.isArray(ultimaData) && ultimaData.length > 0) {
    fechaInicio = new Date(`${ultimaData[0].fecha}T00:00:00Z`);
    fechaInicio.setUTCDate(fechaInicio.getUTCDate() + 1);
  }

  const fechaFin = new Date(`${hoyBogota}T00:00:00Z`);
  if (fechaInicio > fechaFin) {
    console.log('ℹ️ tasas_cambio ya está al día hasta', hoyBogota);
    return;
  }

  const { usd, eur, vef } = await obtenerTasasHoy();

  // 3. Construir todos los días pendientes hasta hoy
  const lote = [];
  for (let d = new Date(fechaInicio); d <= fechaFin; d.setUTCDate(d.getUTCDate() + 1)) {
    lote.push({
      fecha: d.toISOString().split('T')[0],
      usd,
      eur,
      vef
    });
  }

  // 4. Upsert en tasas_cambio
  const resIns = await fetch(`${SUPABASE_URL}/rest/v1/tasas_cambio?on_conflict=fecha`, {
    method: 'POST',
    headers: headersSupabase,
    body: JSON.stringify(lote)
  });
  if (!resIns.ok) throw new Error(await resIns.text());

  // 5. Actualizar tasa_base en monedas
  const resMonedas = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/monedas?codigo=eq.USD`, {
      method: 'PATCH', headers: headersSupabase, body: JSON.stringify({ tasa_base: usd })
    }),
    fetch(`${SUPABASE_URL}/rest/v1/monedas?codigo=eq.EUR`, {
      method: 'PATCH', headers: headersSupabase, body: JSON.stringify({ tasa_base: eur })
    }),
    fetch(`${SUPABASE_URL}/rest/v1/monedas?codigo=in.(VEF,VES)`, {
      method: 'PATCH', headers: headersSupabase, body: JSON.stringify({ tasa_base: vef })
    })
  ]);

  for (const r of resMonedas) {
    if (!r.ok) throw new Error(await r.text());
  }

  console.log(`✅ Actualizados ${lote.length} día(s) hasta ${hoyBogota} (USD: ${usd}, EUR: ${eur}, VEF: ${vef})`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});