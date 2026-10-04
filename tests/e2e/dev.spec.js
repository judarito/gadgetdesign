import { expect, test } from '@playwright/test'

const expectedHost = 'gadgetdesign-dev.netlify.app'
const adminPassword = process.env.DEV_ADMIN_PASSWORD || ''

test.beforeEach(async ({ page }) => {
  const host = new URL(page.context()._options?.baseURL || process.env.E2E_BASE_URL || `https://${expectedHost}`).host
  if (host !== expectedHost) {
    throw new Error(`E2E bloqueado: solo puede ejecutarse contra ${expectedHost}, no contra ${host}.`)
  }
})

test('sitio dev responde y expone metadata del despliegue', async ({ page }) => {
  const response = await page.request.get('/build-info.json', { failOnStatusCode: true })
  const info = await response.json()
  expect(info.commit).toBeTruthy()

  const health = await page.request.get('/.netlify/functions/health', { failOnStatusCode: true })
  await expect(health).toBeOK()
  expect((await health.json()).status).toBe('ok')

  await page.goto('/portal')
  await expect(page.getByRole('heading', { name: 'Mis fichas' })).toBeVisible()
})

test('admin permite dos fichas con el mismo nombre visible y ambas rutas públicas funcionan', async ({ page }) => {
  if (!adminPassword) {
    throw new Error('Falta el secreto DEV_ADMIN_PASSWORD para ejecutar el E2E administrativo.')
  }

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const displayName = `E2E-Max-${runId}`
  const api = page.context().request

  await page.goto('/admin')
  await page.getByLabel('Contraseña').fill(adminPassword)
  await page.getByRole('button', { name: 'Entrar al administrador' }).click()
  await expect(page.getByRole('heading', { name: 'Entidades y URLs' })).toBeVisible()

  try {
    for (let i = 0; i < 2; i += 1) {
      await page.getByRole('button', { name: 'Nueva entidad' }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await dialog.getByLabel('Nombre visible').fill(displayName)

      const category = dialog.getByLabel('Categoría')
      const options = await category.locator('option').count()
      expect(options).toBeGreaterThan(0)

      await dialog.getByRole('button', { name: 'Guardar' }).click()
      await expect(dialog).toBeHidden()
    }

    const search = page.getByPlaceholder('Nombre visible, código o cliente')
    await search.fill(displayName)
    await page.getByRole('button', { name: 'Filtrar' }).click()

    const rows = page.locator('article.entity-row').filter({ hasText: displayName })
    await expect(rows).toHaveCount(2)

    const hrefs = await rows.locator('.entity-url a').evaluateAll((links) =>
      links.map((link) => link.href),
    )
    expect(new Set(hrefs).size).toBe(2)

    for (const href of hrefs) {
      const publicPage = await page.context().newPage()
      await publicPage.goto(href)
      await expect(publicPage.getByText(displayName, { exact: true }).first()).toBeVisible()
      await publicPage.close()
    }
  } finally {
    const list = await api.get(
      `/.netlify/functions/admin?action=entities&search=${encodeURIComponent(displayName)}&pageSize=50`,
    )

    if (list.ok()) {
      const payload = await list.json()
      for (const entity of payload.items || []) {
        if (entity.displayName !== displayName) continue
        await api.delete('/.netlify/functions/admin?action=delete-entity', {
          data: { id: entity.id },
        })
      }
    }
  }
})
