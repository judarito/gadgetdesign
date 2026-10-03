<script setup>
import { computed, onMounted, ref } from 'vue'
import {
  ChevronRight,
  Copy,
  LogOut,
  Mail,
  Package,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from '@lucide/vue'
import {
  getPortalContext,
  logoutClientAccess,
  requestClientAccessCode,
  verifyClientAccessCode,
} from './services/clientApi'

const client = ref(null)
const items = ref([])
const total = ref(0)
const search = ref('')
const isLoading = ref(false)
const isSaving = ref(false)
const errorMessage = ref('')
const toast = ref({ visible: false, message: '', color: 'success' })

const email = ref('')
const code = ref('')
const step = ref('email')

const isAuthenticated = computed(() => Boolean(client.value))
const groups = computed(() => {
  const map = new Map()
  for (const item of items.value) {
    if (!map.has(item.categoryName)) map.set(item.categoryName, [])
    map.get(item.categoryName).push(item)
  }
  return [...map.entries()].map(([name, entries]) => ({ name, entries }))
})

onMounted(async () => {
  try {
    applyContext(await getPortalContext())
  } catch (error) {
    // Un 401 solo significa que todavía no hay sesión de portal.
    if (error.status !== 401) errorMessage.value = error.message
  }
})

function applyContext(result) {
  client.value = result.cliente
  items.value = result.items || []
  total.value = Number(result.total || 0)
  code.value = ''
}

async function requestCode() {
  if (isSaving.value || !email.value.trim()) return
  await runAction(async () => {
    await requestClientAccessCode(email.value.trim())
    step.value = 'code'
    // Mensaje neutro a propósito: el servidor responde igual exista o no el
    // correo, para no revelar qué direcciones están registradas.
    showToast('Si el correo está registrado, enviamos un código.', 'success')
  })
}

async function verifyCode() {
  if (isSaving.value || !/^\d{6}$/.test(code.value)) return
  await runAction(async () => {
    applyContext(await verifyClientAccessCode(email.value.trim(), code.value))
    step.value = 'email'
    showToast(`Bienvenido, ${client.value?.name || ''}.`)
  })
}

async function logout() {
  await logoutClientAccess().catch(() => {})
  client.value = null
  items.value = []
  total.value = 0
  email.value = ''
  code.value = ''
  step.value = 'email'
  search.value = ''
  showToast('Sesión cerrada.')
}

async function applySearch() {
  if (!isAuthenticated.value) return
  await runLoad(async () => {
    applyContext(await getPortalContext({ search: search.value }))
  })
}

async function clearSearch() {
  search.value = ''
  await applySearch()
}

function buildEntityUrl(item) {
  const origin = window.location.origin
  if (item.shortCode) return `${origin}/${item.shortCode}`
  return `${origin}/${item.categoryCode}/${item.id}`
}

async function copyUrl(item) {
  try {
    await navigator.clipboard.writeText(buildEntityUrl(item))
    showToast('Enlace copiado al portapapeles.')
  } catch {
    showToast('No fue posible copiar el enlace.', 'error')
  }
}

async function runLoad(callback) {
  isLoading.value = true
  errorMessage.value = ''
  try {
    await callback()
  } catch (error) {
    errorMessage.value = error.message || 'Ocurrió un error inesperado.'
  } finally {
    isLoading.value = false
  }
}

async function runAction(callback) {
  isSaving.value = true
  errorMessage.value = ''
  try {
    await callback()
  } catch (error) {
    errorMessage.value = error.message || 'Ocurrió un error inesperado.'
    showToast(errorMessage.value, 'error')
  } finally {
    isSaving.value = false
  }
}

function showToast(message, color = 'success') {
  toast.value = { visible: true, message, color }
}
</script>

<template>
  <v-app>
    <main class="portal">
      <header class="portal-header">
        <div class="portal-brand">
          <span class="portal-logo"><ShieldCheck :size="22" /></span>
          <div><strong>Gadget</strong><span>Design</span></div>
        </div>
        <v-btn v-if="isAuthenticated" variant="tonal" @click="logout">
          <LogOut :size="17" /> Salir
        </v-btn>
      </header>

      <section v-if="!isAuthenticated" class="portal-login">
        <h1>Mis fichas</h1>
        <p>Entra con el correo que registró el administrador y administra todo lo que está a tu nombre.</p>

        <p v-if="errorMessage" class="portal-alert" role="alert">{{ errorMessage }}</p>

        <form v-if="step === 'email'" class="portal-form" @submit.prevent="requestCode">
          <label>
            <span>Correo electrónico</span>
            <input
              v-model="email"
              type="email"
              autocomplete="email"
              maxlength="254"
              placeholder="nombre@correo.com"
              required
            />
          </label>
          <v-btn color="primary" :loading="isSaving" type="submit" variant="flat">
            <Mail :size="18" /> Enviar código
          </v-btn>
        </form>

        <form v-else class="portal-form" @submit.prevent="verifyCode">
          <p class="portal-hint">Escribimos un código de seis dígitos a <strong>{{ email }}</strong>. Vence en 10 minutos.</p>
          <label>
            <span>Código</span>
            <input
              v-model="code"
              class="code-input"
              inputmode="numeric"
              maxlength="6"
              pattern="\d{6}"
              placeholder="000000"
              required
            />
          </label>
          <v-btn color="primary" :disabled="!code" :loading="isSaving" type="submit" variant="flat">
            Entrar
          </v-btn>
          <v-btn variant="text" type="button" @click="step = 'email'">Usar otro correo</v-btn>
        </form>
      </section>

      <section v-else class="portal-body">
        <div class="portal-greeting">
          <h1>{{ client.name }}</h1>
          <p>{{ total }} {{ total === 1 ? 'ficha registrada' : 'fichas registradas' }} a tu nombre.</p>
        </div>

        <form class="portal-search" @submit.prevent="applySearch">
          <label>
            <span class="sr-only">Buscar ficha</span>
            <div class="portal-search-field">
              <Search :size="18" />
              <input v-model="search" maxlength="200" placeholder="Buscar por identificación" />
              <button v-if="search" type="button" aria-label="Limpiar búsqueda" @click="clearSearch">
                <X :size="16" />
              </button>
            </div>
          </label>
          <v-btn color="primary" type="submit" variant="tonal">Buscar</v-btn>
        </form>

        <p v-if="errorMessage" class="portal-alert" role="alert">{{ errorMessage }}</p>

        <div v-if="isLoading" class="portal-empty" role="status">Cargando tus fichas...</div>
        <div v-else-if="!items.length" class="portal-empty">
          {{ search ? 'No encontramos fichas con ese texto.' : 'Todavía no tienes fichas asignadas.' }}
        </div>

        <div v-for="group in groups" :key="group.name" class="portal-group">
          <h2>{{ group.name }}</h2>
          <article v-for="item in group.entries" :key="item.id" class="portal-item">
            <div class="portal-item-info">
              <span class="portal-item-icon"><Package :size="18" /></span>
              <div>
                <strong>{{ item.identificacion }}</strong>
                <span>
                  {{ item.dataCount }} {{ item.dataCount === 1 ? 'dato' : 'datos' }}
                  <template v-if="item.protectedCount"> · {{ item.protectedCount }} protegido</template>
                </span>
              </div>
            </div>
            <div class="portal-item-actions">
              <button type="button" title="Copiar enlace" @click="copyUrl(item)"><Copy :size="18" /></button>
              <a :href="buildEntityUrl(item)" class="portal-open">
                Abrir ficha <ChevronRight :size="17" />
              </a>
            </div>
          </article>
        </div>

        <p class="portal-note">
          <RefreshCw :size="16" />
          Al abrir una ficha la verás desbloqueada: puedes editar sus datos y agregar nuevos.
        </p>
      </section>

      <v-snackbar v-model="toast.visible" :color="toast.color" :timeout="3200" location="bottom">
        {{ toast.message }}
        <template #actions>
          <v-btn icon variant="text" aria-label="Cerrar notificación" @click="toast.visible = false">
            <X :size="18" />
          </v-btn>
        </template>
      </v-snackbar>
    </main>
  </v-app>
</template>

<style scoped>
.portal { min-height: 100vh; padding: 22px 16px 60px; color: #172033; background: #f7fbff; }
.portal-header { display: flex; align-items: center; justify-content: space-between; gap: 14px; width: min(100%, 780px); margin: 0 auto 26px; }
.portal-brand { display: flex; align-items: center; gap: 10px; font-size: 1.05rem; letter-spacing: -.01em; }
.portal-brand strong { color: #071045; }
.portal-brand span { color: #4d6a94; }
.portal-logo { display: grid; width: 40px; height: 40px; place-items: center; color: #0873ff; background: #e8f2ff; border-radius: 11px; }
.portal-login, .portal-body { width: min(100%, 780px); margin: 0 auto; }
.portal-login h1, .portal-greeting h1 { margin: 0 0 8px; color: #071045; font-size: 1.7rem; }
.portal-login > p, .portal-greeting p { margin: 0 0 22px; color: #5b6b82; }
.portal-form { display: grid; gap: 14px; padding: 22px; background: #fff; border: 1px solid #dce5ef; border-radius: 14px; }
.portal-form label { display: grid; gap: 6px; color: #4b5b72; font-size: .84rem; font-weight: 700; }
.portal-form input { min-height: 46px; padding: 0 12px; color: #172033; background: #fff; border: 1px solid #cdd9e7; border-radius: 8px; font-size: 1rem; }
.portal-form input:focus-visible { border-color: #0873ff; outline: 2px solid #cfe4ff; }
.code-input { letter-spacing: .5em; text-align: center; font-size: 1.4rem !important; }
.portal-hint { margin: 0; color: #5b6b82; font-size: .9rem; }
.portal-alert { margin: 0 0 16px; padding: 12px 14px; color: #9c1f2b; background: #fff5f5; border: 1px solid #ffd6da; border-radius: 9px; }
.portal-search { display: flex; gap: 10px; align-items: end; margin-bottom: 22px; }
.portal-search label { flex: 1; }
.portal-search-field { display: flex; align-items: center; gap: 8px; min-height: 46px; padding: 0 12px; background: #fff; border: 1px solid #cdd9e7; border-radius: 8px; color: #6d7d94; }
.portal-search-field input { width: 100%; min-width: 0; border: 0; outline: 0; font-size: .98rem; }
.portal-search-field button { display: grid; place-items: center; padding: 4px; color: #6d7d94; background: none; border: 0; cursor: pointer; }
.portal-empty { padding: 40px 20px; color: #748298; text-align: center; background: #fff; border: 1px solid #dce5ef; border-radius: 12px; }
.portal-group { margin-bottom: 26px; }
.portal-group h2 { margin: 0 0 10px; color: #3d5678; font-size: .8rem; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; }
.portal-item { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 15px 18px; background: #fff; border: 1px solid #dce5ef; border-bottom: 0; }
.portal-item:first-of-type { border-radius: 12px 12px 0 0; }
.portal-item:last-of-type { border-bottom: 1px solid #dce5ef; border-radius: 0 0 12px 12px; }
.portal-item:only-of-type { border-radius: 12px; }
.portal-item-info { display: flex; align-items: center; gap: 12px; min-width: 0; }
.portal-item-info > div { display: grid; gap: 2px; min-width: 0; }
.portal-item-info strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.portal-item-info span { color: #748298; font-size: .84rem; }
.portal-item-icon { display: grid; width: 36px; height: 36px; flex: 0 0 auto; place-items: center; color: #0873ff; background: #edf6ff; border-radius: 9px; }
.portal-item-actions { display: flex; align-items: center; gap: 8px; }
.portal-item-actions button { display: grid; width: 36px; height: 36px; place-items: center; color: #3f5f86; background: #fff; border: 1px solid #d8e2ed; border-radius: 8px; cursor: pointer; }
.portal-item-actions button:hover { color: #0873ff; border-color: #9fc8f9; }
.portal-open { display: inline-flex; align-items: center; gap: 4px; padding: 9px 14px; color: #0873ff; font-size: .9rem; font-weight: 700; text-decoration: none; background: #edf6ff; border-radius: 8px; }
.portal-open:hover { background: #dcecff; }
.portal-note { display: flex; align-items: center; gap: 9px; margin: 26px 0 0; color: #5b6b82; font-size: .88rem; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

@media (max-width: 620px) {
  .portal-item { flex-direction: column; align-items: stretch; }
  .portal-item-actions { justify-content: space-between; }
  .portal-search { flex-direction: column; align-items: stretch; }
}
</style>
