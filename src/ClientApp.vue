<script setup>
import { computed, onMounted, ref } from 'vue'
import {
  Boxes,
  ChevronRight,
  Copy,
  Info,
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
const page = ref(1)
const search = ref('')
const isLoading = ref(false)
const isSaving = ref(false)
const errorMessage = ref('')
const toast = ref({ visible: false, message: '', color: 'success' })

const email = ref('')
const code = ref('')
const step = ref('email')
// Solo llega con `OTP_DEV_HINT` en el entorno de pruebas: el sitio de dev no
// envía correos y su canalización de logs pierde líneas, así que el código se
// muestra en pantalla. En producción el campo nunca viene.
const devCode = ref('')
// Mientras se comprueba si ya hay sesión no debe verse el formulario de correo:
// un cliente con sesión abierta vería un parpadeo del login antes del listado.
const checkingSession = ref(true)

const isAuthenticated = computed(() => Boolean(client.value))
const pending = computed(() => Math.max(total.value - items.value.length, 0))
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
  } finally {
    checkingSession.value = false
  }
})

function applyContext(result, { append = false } = {}) {
  client.value = result.cliente
  // El servidor pagina de 50 en 50: sin acumular, un cliente con muchas fichas
  // (una finca con cien vacas) vería el total pero solo la primera página.
  items.value = append ? [...items.value, ...(result.items || [])] : (result.items || [])
  total.value = Number(result.total || 0)
  page.value = Number(result.page || 1)
  code.value = ''
  devCode.value = ''
}

async function loadMore() {
  if (!pending.value) return
  await runLoad(async () => {
    applyContext(await getPortalContext({ search: search.value, page: page.value + 1 }), { append: true })
  })
}

async function requestCode() {
  if (isSaving.value || !email.value.trim()) return
  await runAction(async () => {
    const result = await requestClientAccessCode(email.value.trim())
    // En el entorno de pruebas el código viene en la respuesta; se deja escrito
    // en el campo para no tener que copiarlo a mano.
    devCode.value = result?.devCode || ''
    code.value = devCode.value
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
  devCode.value = ''
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

/**
 * La ruta pública resuelve por código corto o por token interno; el id numérico
 * de la ficha no resuelve nunca. Sin código corto no hay enlace que ofrecer, así
 * que se devuelve cadena vacía y la interfaz no pinta el enlace.
 */
function buildEntityUrl(item) {
  if (!item.shortCode) return ''
  return `${window.location.origin}/${item.shortCode}`
}

async function copyUrl(item) {
  const url = buildEntityUrl(item)
  if (!url) {
    showToast('Esta ficha todavía no tiene enlace público.', 'error')
    return
  }
  try {
    await navigator.clipboard.writeText(url)
    showToast('Enlace copiado al portapapeles.')
  } catch {
    showToast('No fue posible copiar el enlace.', 'error')
  }
}

/**
 * La sesión del portal puede dejar de valer a mitad de uso: expira a las 8 horas
 * o el administrador cambia el correo del cliente, lo que sube su auth_version.
 * En ese caso no basta con pintar el error: hay que volver al formulario, o el
 * cliente se queda viendo su listado viejo como si siguiera dentro.
 */
function handleError(error) {
  if (error?.status === 401) {
    client.value = null
    items.value = []
    total.value = 0
    page.value = 1
    step.value = 'email'
    devCode.value = ''
    showToast('Tu sesión expiró. Vuelve a entrar con tu correo.', 'error')
    return
  }
  errorMessage.value = error?.message || 'Ocurrió un error inesperado.'
}

async function runLoad(callback) {
  isLoading.value = true
  errorMessage.value = ''
  try {
    await callback()
  } catch (error) {
    handleError(error)
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
    handleError(error)
    if (error?.status !== 401) showToast(errorMessage.value, 'error')
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
    <main v-if="checkingSession" class="login-page">
      <section class="login-panel login-panel--waiting">
        <span class="login-logo"><ShieldCheck :size="30" /></span>
        <p class="waiting-note" role="status">Comprobando tu sesión...</p>
      </section>
    </main>

    <main v-else-if="!isAuthenticated" class="login-page">
      <section class="login-panel">
        <div class="login-brand">
          <span class="login-logo"><ShieldCheck :size="30" /></span>
          <div><strong>Gadget</strong>Design</div>
        </div>

        <div class="login-copy">
          <p class="eyebrow">Portal del cliente</p>
          <h1>Mis fichas</h1>
          <p>Entra con el correo que registró el administrador y administra todo lo que está a tu nombre.</p>
        </div>

        <form v-if="step === 'email'" @submit.prevent="requestCode">
          <label class="field">
            <span>Correo electrónico</span>
            <div class="icon-field">
              <Mail :size="19" />
              <input
                v-model="email"
                type="email"
                autocomplete="email"
                maxlength="254"
                placeholder="nombre@correo.com"
                required
              />
            </div>
          </label>

          <p v-if="errorMessage" class="alert alert--error" role="alert">{{ errorMessage }}</p>

          <v-btn
            block
            class="primary-command"
            color="primary"
            :loading="isSaving"
            size="large"
            type="submit"
            variant="flat"
          >
            <Mail :size="18" /> Enviar código
          </v-btn>
        </form>

        <form v-else @submit.prevent="verifyCode">
          <p class="code-copy">
            Escribimos un código de seis dígitos a <strong>{{ email }}</strong>. Vence en 10 minutos.
          </p>

          <div v-if="devCode" class="dev-hint" role="status">
            <Info :size="19" />
            <div>
              <strong>Modo de pruebas</strong>
              <span>Este sitio no envía correos. Tu código es <code>{{ devCode }}</code>.</span>
            </div>
          </div>

          <label class="field">
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

          <p v-if="errorMessage" class="alert alert--error" role="alert">{{ errorMessage }}</p>

          <v-btn
            block
            class="primary-command"
            color="primary"
            :disabled="!code"
            :loading="isSaving"
            size="large"
            type="submit"
            variant="flat"
          >
            Entrar
          </v-btn>
          <v-btn block variant="text" type="button" @click="step = 'email'">Usar otro correo</v-btn>
        </form>
      </section>
    </main>

    <div v-else class="portal-shell">
      <header class="portal-header">
        <div class="portal-brand">
          <span class="portal-logo"><Boxes :size="25" /></span>
          <div><strong>Gadget</strong><span>Design</span></div>
        </div>

        <div class="portal-heading">
          <p>Portal del cliente</p>
          <h1>{{ client.name }}</h1>
        </div>

        <span class="session-badge"><ShieldCheck :size="17" /> Sesión de cliente</span>
        <v-btn variant="tonal" @click="logout"><LogOut :size="17" /> Salir</v-btn>
      </header>

      <section class="portal-content">
        <p v-if="errorMessage" class="alert alert--error" role="alert">{{ errorMessage }}</p>

        <div class="section-toolbar">
          <div>
            <h2>Fichas a tu nombre</h2>
            <p>
              {{ total }} {{ total === 1 ? 'ficha registrada' : 'fichas registradas' }}.
              Al abrir una la verás desbloqueada.
            </p>
          </div>

          <form class="portal-search" @submit.prevent="applySearch">
            <label class="search-field">
              <span class="sr-only">Buscar ficha</span>
              <div>
                <Search :size="18" />
                <input v-model="search" maxlength="200" placeholder="Buscar por nombre visible" />
                <button v-if="search" type="button" aria-label="Limpiar búsqueda" @click="clearSearch">
                  <X :size="16" />
                </button>
              </div>
            </label>
            <v-btn class="filter-button" color="primary" type="submit" variant="flat">Buscar</v-btn>
          </form>
        </div>

        <div v-if="isLoading && !items.length" class="data-table">
          <div class="table-empty" role="status">Cargando tus fichas...</div>
        </div>

        <div v-else-if="!items.length" class="data-table">
          <div class="table-empty">
            {{ search ? 'No encontramos fichas con ese texto.' : 'Todavía no tienes fichas asignadas.' }}
          </div>
        </div>

        <template v-else>
          <div v-for="group in groups" :key="group.name" class="portal-group">
            <h2 class="group-title">{{ group.name }}</h2>
            <div class="data-table">
              <div v-for="item in group.entries" :key="item.id" class="table-row entity-row">
                <div class="primary-cell">
                  <span class="cell-icon"><Package :size="18" /></span>
                  <div>
                    <strong>{{ item.displayName }}</strong>
                    <small>
                      {{ item.dataCount }} {{ item.dataCount === 1 ? 'dato' : 'datos' }}
                      <template v-if="item.protectedCount"> · {{ item.protectedCount }} protegido</template>
                    </small>
                  </div>
                </div>

                <div class="action-cell">
                  <button type="button" aria-label="Copiar enlace" title="Copiar enlace" @click="copyUrl(item)">
                    <Copy :size="18" />
                  </button>
                  <a v-if="buildEntityUrl(item)" :href="buildEntityUrl(item)" class="portal-open">
                    Abrir ficha <ChevronRight :size="17" />
                  </a>
                  <span v-else class="muted-note">Sin enlace público</span>
                </div>
              </div>
            </div>
          </div>

          <div v-if="pending" class="pagination-bar">
            <span>Mostrando {{ items.length }} de {{ total }}</span>
            <v-btn variant="tonal" :loading="isLoading" @click="loadMore">
              Ver {{ pending }} {{ pending === 1 ? 'ficha más' : 'fichas más' }}
            </v-btn>
          </div>
        </template>

        <p class="portal-note">
          <RefreshCw :size="16" />
          Puedes editar los datos de una ficha y agregar nuevos; para eliminarla
          entera hay que entrar por su código QR.
        </p>
      </section>
    </div>

    <v-snackbar v-model="toast.visible" :color="toast.color" :timeout="3200" location="bottom">
      {{ toast.message }}
      <template #actions>
        <v-btn icon variant="text" aria-label="Cerrar notificación" @click="toast.visible = false">
          <X :size="18" />
        </v-btn>
      </template>
    </v-snackbar>
  </v-app>
</template>

<style scoped>
button, input { font: inherit; }
button { letter-spacing: 0; }

/* --- Login: mismos materiales que el panel administrativo ------------- */
.login-page {
  display: grid;
  min-height: 100vh;
  padding: 24px;
  place-items: center;
  color: #10172a;
  background: linear-gradient(145deg, #eef7ff 0%, #ffffff 50%, #edfaf8 100%);
}
.login-panel {
  width: min(100%, 440px);
  padding: 34px;
  background: #fff;
  border: 1px solid #dce6f1;
  border-radius: 8px;
  box-shadow: 0 22px 60px rgba(35, 62, 98, .14);
}
.login-panel--waiting { display: grid; justify-items: center; gap: 14px; }
.waiting-note { margin: 0; color: #66758c; }
.login-brand { display: flex; align-items: center; gap: 12px; margin-bottom: 38px; color: #090d3f; font-size: 1.35rem; }
.login-logo {
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  color: #fff;
  background: linear-gradient(135deg, #0873ff, #18d5d7);
  border-radius: 8px;
}
.login-copy .eyebrow { margin: 0 0 7px; color: #0873ff; font-size: .78rem; font-weight: 800; text-transform: uppercase; }
.login-copy h1 { margin: 0; font-size: 2rem; letter-spacing: 0; }
.login-copy > p:last-child { margin: 9px 0 26px; color: #66758c; }
.code-copy { margin: 0 0 18px; color: #66758c; }
.field { display: grid; gap: 7px; color: #34445e; font-size: .88rem; font-weight: 700; }
.field input { width: 100%; min-height: 44px; padding: 0 12px; color: #121a2d; background: #fff; border: 1px solid #cdd9e7; border-radius: 6px; outline: 0; }
.field input:focus { border-color: #0873ff; box-shadow: 0 0 0 3px rgba(8, 115, 255, .12); }
.icon-field { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 9px; padding: 0 12px; color: #7b8ba3; border: 1px solid #cdd9e7; border-radius: 6px; }
.icon-field:focus-within { border-color: #0873ff; box-shadow: 0 0 0 3px rgba(8, 115, 255, .12); }
.icon-field input { padding: 0; border: 0; box-shadow: none; }
.code-input { letter-spacing: .5em; text-align: center; font-size: 1.35rem !important; }
.primary-command { margin-top: 20px; min-height: 46px; text-transform: none; font-weight: 750; letter-spacing: 0; }
.primary-command :deep(.v-btn__content) { gap: 8px; }
.alert { display: flex; align-items: center; gap: 9px; margin: 16px 0 0; padding: 12px 14px; border-radius: 6px; font-weight: 650; }
.alert--error { color: #a41924; background: #fff0f1; border: 1px solid #ffcfd3; }

/* --- Aviso de pruebas: el código en pantalla -------------------------- */
.dev-hint {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  margin-bottom: 18px;
  padding: 13px 14px;
  color: #264b7c;
  background: #edf6ff;
  border: 1px solid #d4e8fb;
  border-radius: 7px;
}
.dev-hint > div { display: grid; gap: 3px; }
.dev-hint strong { font-size: .82rem; text-transform: uppercase; letter-spacing: .04em; }
.dev-hint span { color: #4b6484; font-size: .9rem; }
.dev-hint code { padding: 2px 7px; color: #0b4da2; background: #fff; border: 1px solid #cfe4ff; border-radius: 4px; font-size: 1rem; font-weight: 800; letter-spacing: .12em; }

/* --- Sesión abierta: cabecera y contenido del panel ------------------- */
.portal-shell { min-height: 100vh; color: #111827; background: #f4f7fb; }
.portal-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  min-height: 86px;
  padding: 17px 32px;
  background: #fff;
  border-bottom: 1px solid #dfe7f0;
}
.portal-brand { display: flex; align-items: center; gap: 11px; color: #090d3f; font-size: 1.16rem; }
.portal-brand div { display: flex; }
.portal-brand span { font-weight: 400; }
.portal-logo {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  color: #fff;
  background: linear-gradient(135deg, #0873ff, #18d5d7);
  border-radius: 7px;
}
.portal-heading { padding-left: 14px; border-left: 1px solid #e2e9f2; }
.portal-heading p { margin: 0 0 2px; color: #718097; font-size: .76rem; font-weight: 750; text-transform: uppercase; }
.portal-heading h1 { margin: 0; font-size: 1.55rem; line-height: 1.15; }
.session-badge {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-left: auto;
  padding: 8px 10px;
  color: #16795b;
  font-size: .82rem;
  font-weight: 700;
  background: #eaf8f2;
  border: 1px solid #ccecdf;
  border-radius: 6px;
}
.portal-header :deep(.v-btn) { text-transform: none; font-weight: 700; letter-spacing: 0; }
.portal-header :deep(.v-btn__content) { gap: 8px; }

.portal-content { width: min(100%, 1240px); margin: 0 auto; padding: 30px 32px 60px; }
.portal-content .alert { margin: 0 0 18px; }
.section-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 22px; }
.section-toolbar h2 { margin: 0; font-size: 1.25rem; }
.section-toolbar p { margin: 5px 0 0; color: #69788e; }
.section-toolbar :deep(.v-btn) { text-transform: none; font-weight: 700; letter-spacing: 0; }
.portal-search { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; }
/* La clase va en el propio `label`, como en el panel, para que `> div` alcance
   la caja: con la clase en el `form` la caja quedaba a dos niveles y se pintaba
   sin borde, con el icono descolgado encima del texto. */
.search-field { display: grid; gap: 7px; width: min(100%, 320px); color: #34445e; font-size: .88rem; font-weight: 700; }
.search-field > div { display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 11px; background: #fff; border: 1px solid #cdd9e7; border-radius: 6px; }
.search-field > div:focus-within { border-color: #0873ff; box-shadow: 0 0 0 3px rgba(8, 115, 255, .12); }
.search-field input { width: 100%; min-width: 0; border: 0; outline: 0; }
.search-field button { display: grid; place-items: center; padding: 4px; color: #6d7d94; background: none; border: 0; cursor: pointer; }
.filter-button { min-height: 44px; }

.portal-group { margin-bottom: 26px; }
.group-title { margin: 0 0 10px; color: #6c7a90; font-size: .76rem; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; }
.data-table { overflow: hidden; background: #fff; border: 1px solid #dce5ef; border-radius: 7px; }
.table-row { display: grid; align-items: center; gap: 18px; padding: 0 18px; color: #4e5d73; border-bottom: 1px solid #e5ebf2; }
.table-row:last-child { border-bottom: 0; }
.entity-row { grid-template-columns: minmax(180px, 1fr) auto; min-height: 74px; }
.table-empty { padding: 38px 20px; color: #748298; text-align: center; }
.primary-cell { display: flex; align-items: center; gap: 11px; min-width: 0; color: #172033; }
.primary-cell > div { display: grid; gap: 2px; min-width: 0; }
.primary-cell strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.primary-cell small { overflow: hidden; color: #748298; font-size: .8rem; text-overflow: ellipsis; white-space: nowrap; }
.cell-icon { display: grid; width: 34px; height: 34px; flex: 0 0 auto; place-items: center; color: #0873ff; background: #edf6ff; border-radius: 6px; }
.action-cell { display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
.action-cell button { display: grid; width: 34px; height: 34px; place-items: center; color: #3f5f86; background: #fff; border: 1px solid #d8e2ed; border-radius: 6px; cursor: pointer; }
.action-cell button:hover { color: #0873ff; border-color: #9fc8f9; }
.portal-open {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 9px 14px;
  color: #0873ff;
  font-size: .9rem;
  font-weight: 700;
  text-decoration: none;
  background: #edf6ff;
  border-radius: 6px;
}
.portal-open:hover { background: #dcecff; }
.muted-note { overflow: hidden; color: #748298; font-size: .8rem; text-overflow: ellipsis; white-space: nowrap; }
.pagination-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 14px; margin-top: 14px; color: #68778c; font-size: .84rem; }
.pagination-bar :deep(.v-btn) { text-transform: none; font-weight: 700; letter-spacing: 0; }
.portal-note {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 26px 0 0;
  padding: 14px 15px;
  color: #3d5678;
  background: #edf6ff;
  border: 1px solid #d4e8fb;
  border-radius: 7px;
}
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

@media (max-width: 720px) {
  .portal-header { padding: 14px 18px; }
  .portal-heading { padding-left: 0; border-left: 0; }
  .session-badge { margin-left: 0; }
  .portal-content { padding: 22px 18px 50px; }
  .section-toolbar { align-items: stretch; }
  .search-field { flex-direction: column; align-items: stretch; }
  .entity-row { grid-template-columns: 1fr; gap: 12px; padding: 14px 18px; }
  .action-cell { justify-content: space-between; }
}
</style>
