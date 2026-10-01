export async function sendAccessCode({ to, code, identification }) {
  const mode = process.env.OTP_DELIVERY_MODE || 'resend'
  if (mode === 'console') {
    console.log(`[Gadget Design] Código local para ${identification}: ${code}`)
    return
  }

  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) {
    throw new Error('El servicio de correo no está configurado.')
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM,
      to: [to],
      subject: 'Tu código de acceso de Gadget Design',
      html: `<div style="font-family:Arial,sans-serif;color:#071045"><h2>Código de acceso</h2><p>Usa este código para consultar y administrar <strong>${escapeHtml(identification)}</strong>:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">${code}</p><p>El código vence en 10 minutos. Si no lo solicitaste, ignora este mensaje.</p></div>`,
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    console.error('Resend error:', detail)
    throw new Error('No fue posible enviar el código de acceso.')
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character])
}
