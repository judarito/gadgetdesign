<script setup>
import { computed, onMounted, ref } from 'vue'
import QRCode from 'qrcode'
import {
  Boxes,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  KeyRound,
  Lightbulb,
  Link,
  LogOut,
  Menu,
  Pencil,
  Plus,
  Printer,
  QrCode as QrCodeIcon,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Tag,
  Trash2,
  Users,
  X,
} from '@lucide/vue'
import {
  changeAdminPassword,
  clearAdminSession,
  createAdminSession,
  createEntity,
  deleteCategory,
  deleteEntity,
  deleteSuggestion,
  hasAdminSession,
  listCategories,
  listCategoryOptions,
  listEntities,
  listSuggestions,
  regenerateEntityToken,
  saveCategory,
  saveSuggestion,
  updateEntity,
  verifyAdminPassword,
} from './services/adminApi'
import { CATEGORY_CODE_MAX_LENGTH, IDENTIFICATION_MAX_LENGTH } from './services/validation'
import { CUSTOM_DATA_TYPES, getDataType } from './services/dataTypes'
import { createSlicerQrSvg } from './services/qrSvg'
import { getQrPrintMetrics } from './services/qrPrintMetrics'

const PUBLIC_ORIGIN = 'https://gadgetdesign.lat'

const authenticated = ref(false)
const password = ref('')
const showPassword = ref(false)
const activeView = ref('entities')
const sidebarOpen = ref(false)
const categories = ref([])
const categoryRows = ref([])
const suggestions = ref([])
const entities = ref([])
const categoryPagination = ref(emptyPagination())
const suggestionPagination = ref(emptyPagination())
const entityPagination = ref(emptyPagination())
const selectedCategoryId = ref(null)
const entityCategoryId = ref(null)
const entitySearch = ref('')
const isLoading = ref(false)
const isSaving = ref(false)
const errorMessage = ref('')
const toast = ref({ visible: false, message: '', color: 'success' })
const categoryDialog = ref(false)
const suggestionDialog = ref(false)
const entityDialog = ref(false)
const qrDialog = ref(false)
const qrEntity = ref(null)
const qrImageUrl = ref('')
const printDialog = ref(false)
const printEntity = ref(null)
const printSettings = ref(defaultPrintSettings())
const categoryDraft = ref(emptyCategory())
const suggestionDraft = ref(emptySuggestion())
const entityDraft = ref(emptyEntity())
const securityForm = ref({ currentPassword: '', newPassword: '', confirmPassword: '' })

const activeCategories = computed(() => categories.value.filter((category) => category.active))
const selectedCategory = computed(() =>
  categories.value.find((category) => category.id === Number(selectedCategoryId.value)),
)
const printMetrics = computed(() => {
  if (!printEntity.value) return null
  return getQrPrintMetrics(buildEntityUrl(printEntity.value), printSettings.value)
})
const pageTitle = computed(
  () =>
    ({
      categories: 'Categorías',
      suggestions: 'Sugerencias',
      entities: 'Entidades',
      security: 'Seguridad',
    })[activeView.value],
)

const navigation = [
  { id: 'entities', label: 'Entidades', icon: Users },
  { id: 'categories', label: 'Categorías', icon: Tag },
  { id: 'suggestions', label: 'Sugerencias', icon: Lightbulb },
  { id: 'security', label: 'Seguridad', icon: ShieldCheck },
]

onMounted(async () => {
  try {
    authenticated.value = await hasAdminSession()
    if (authenticated.value) await loadInitialData()
  } catch {
    authenticated.value = false
  }
})

async function login() {
  if (isSaving.value) return
  await runAction(async () => {
    const isValid = await verifyAdminPassword(password.value)
    if (!isValid) throw new Error('La contraseña no es correcta.')
    createAdminSession()
    authenticated.value = true
    password.value = ''
    await loadInitialData()
  })
}

async function logout() {
  await clearAdminSession().catch(() => {})
  authenticated.value = false
  categories.value = []
  suggestions.value = []
  entities.value = []
  password.value = ''
}

async function loadInitialData() {
  await runLoad(async () => {
    await loadCategories()
    const firstCategory = categories.value[0]
    selectedCategoryId.value ??= firstCategory?.id ?? null
    entityCategoryId.value ??= null
    await loadEntities()
  })
}

async function navigate(view) {
  activeView.value = view
  sidebarOpen.value = false
  clearMessages()

  if (view === 'categories' || view === 'security') return
  if (view === 'suggestions') await loadSuggestions()
  if (view === 'entities') await loadEntities()
}

async function loadCategories() {
  const [options, result] = await Promise.all([
    listCategoryOptions(),
    listCategories({ page: categoryPagination.value.page }),
  ])
  categories.value = options
  categoryRows.value = result.items
  categoryPagination.value = result
}

async function loadSuggestions() {
  if (!selectedCategoryId.value) {
    suggestions.value = []
    return
  }
  await runLoad(async () => {
    const result = await listSuggestions(selectedCategoryId.value, {
      page: suggestionPagination.value.page,
    })
    suggestions.value = result.items
    suggestionPagination.value = result
  })
}

async function loadEntities() {
  await runLoad(async () => {
    const result = await listEntities({
      categoryId: entityCategoryId.value,
      search: entitySearch.value,
      page: entityPagination.value.page,
    })
    entities.value = result.items
    entityPagination.value = result
  })
}

async function applyEntityFilters() {
  entityPagination.value.page = 1
  await loadEntities()
}

async function changeCategoryPage(page) {
  categoryPagination.value.page = page
  await runLoad(loadCategories)
}

async function changeSuggestionPage(page) {
  suggestionPagination.value.page = page
  await loadSuggestions()
}

async function changeEntityPage(page) {
  entityPagination.value.page = page
  await loadEntities()
}

function openCategoryDialog(category = null) {
  categoryDraft.value = category ? { ...category } : emptyCategory()
  categoryDialog.value = true
  clearMessages()
}

async function submitCategory() {
  await runAction(async () => {
    await saveCategory(categoryDraft.value)
    categoryDialog.value = false
    await loadCategories()
    notifySuccess(categoryDraft.value.id ? 'Categoría actualizada.' : 'Categoría creada.')
  })
}

async function removeCategory(category) {
  if (!window.confirm(`¿Eliminar la categoría “${category.name}”?`)) return
  await runAction(async () => {
    await deleteCategory(category.id)
    await loadCategories()
    notifySuccess('Categoría eliminada.')
  })
}

async function changeSuggestionCategory() {
  suggestionPagination.value.page = 1
  await loadSuggestions()
}

function openSuggestionDialog(suggestion = null) {
  if (!selectedCategoryId.value) return
  suggestionDraft.value = suggestion
    ? { ...suggestion }
    : emptySuggestion(
        selectedCategoryId.value,
        Math.min(suggestionPagination.value.total * 10 + 10, 9999),
      )
  suggestionDialog.value = true
  clearMessages()
}

async function submitSuggestion() {
  await runAction(async () => {
    await saveSuggestion({
      ...suggestionDraft.value,
      categoryId: selectedCategoryId.value,
    })
    suggestionDialog.value = false
    await loadSuggestions()
    notifySuccess(suggestionDraft.value.id ? 'Sugerencia actualizada.' : 'Sugerencia creada.')
  })
}

async function removeSuggestion(suggestion) {
  if (!window.confirm(`¿Eliminar la sugerencia “${suggestion.name}”?`)) return
  await runAction(async () => {
    await deleteSuggestion(suggestion.id, selectedCategoryId.value)
    await loadSuggestions()
    notifySuccess('Sugerencia eliminada.')
  })
}

function openEntityDialog(entity = null) {
  entityDraft.value = entity
    ? { ...entity }
    : emptyEntity(activeCategories.value[0]?.id ?? categories.value[0]?.id ?? null)
  entityDialog.value = true
  clearMessages()
}

async function submitEntity() {
  const isEditing = Boolean(entityDraft.value.id)
  let createdUrl = ''
  await runAction(async () => {
    if (isEditing) {
      await updateEntity(entityDraft.value)
    } else {
      const access = await createEntity(entityDraft.value)
      const category = categories.value.find(
        (item) => item.id === Number(entityDraft.value.categoryId),
      )
      createdUrl = buildUrl(category?.code, access.shortCode, true)
    }
    entityDialog.value = false
    await loadEntities()
    await loadCategories()
    notifySuccess(isEditing ? 'Entidad actualizada.' : `Entidad creada: ${createdUrl}`)
  })
}

async function regenerateToken(entity) {
  if (!window.confirm('La URL actual dejará de funcionar. ¿Generar un token nuevo?')) return
  await runAction(async () => {
    const access = await regenerateEntityToken(entity.id)
    entity.token = access.token
    entity.shortCode = access.shortCode
    notifySuccess('Token y URL regenerados.')
  })
}

async function removeEntity(entity) {
  if (!window.confirm(`¿Eliminar la entidad “${entity.identification}”?`)) return
  await runAction(async () => {
    await deleteEntity(entity.id)
    await loadEntities()
    await loadCategories()
    notifySuccess('Entidad eliminada.')
  })
}

async function copyUrl(entity) {
  try {
    await navigator.clipboard.writeText(buildEntityUrl(entity))
    notifySuccess('URL copiada al portapapeles.')
  } catch {
    notifyError('No fue posible copiar la URL.')
  }
}

async function openQr(entity) {
  await runAction(async () => {
    qrEntity.value = entity
    qrImageUrl.value = await generateQrImage(entity)
    qrDialog.value = true
  })
}

function openPrintDialog(entity) {
  printEntity.value = entity
  printSettings.value = defaultPrintSettings()
  printDialog.value = true
  qrDialog.value = false
}

function updateQrSize(event) {
  const size = Number(event.currentTarget.value)
  if (Number.isFinite(size) && size >= 10 && size <= 200) {
    printSettings.value.qrSizeMm = size
  }
}

function restoreQrSize(event) {
  event.currentTarget.value = String(printSettings.value.qrSizeMm)
}

async function downloadPrintSvg() {
  if (!printEntity.value || !printMetrics.value) return
  await runAction(async () => {
    const svg = createSlicerQrSvg(buildEntityUrl(printEntity.value), {
      sizeMm: printSettings.value.qrSizeMm,
    })
    downloadBlob(
      new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
      `qr-${safeFileName(printEntity.value.identification)}-${printSettings.value.qrSizeMm}mm.svg`,
    )
    notifySuccess('QR descargado como SVG compatible con laminadores.')
  })
}

async function downloadPrintStl() {
  if (!printEntity.value || !printMetrics.value) return
  await runAction(async () => {
    const { createPrintableQrStl } = await import('./services/print3d')
    const stl = createPrintableQrStl(buildEntityUrl(printEntity.value), printSettings.value)
    downloadBlob(
      new Blob([stl], { type: 'model/stl' }),
      `${printSettings.value.format}-${safeFileName(printEntity.value.identification)}.stl`,
    )
    notifySuccess('Modelo STL generado y descargado.')
  })
}

function downloadBlob(blob, fileName) {
  const blobUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = blobUrl
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
}

async function generateQrImage(entity) {
  return QRCode.toDataURL(buildEntityUrl(entity), {
    width: 1024,
    margin: 3,
    errorCorrectionLevel: 'H',
    color: { dark: '#071045', light: '#ffffff' },
  })
}

async function submitPasswordChange() {
  const form = securityForm.value
  if (form.newPassword !== form.confirmPassword) {
    notifyError('La confirmación de la nueva contraseña no coincide.')
    return
  }

  await runAction(async () => {
    await changeAdminPassword(form.currentPassword, form.newPassword)
    securityForm.value = { currentPassword: '', newPassword: '', confirmPassword: '' }
    notifySuccess('Contraseña actualizada.')
  })
}

async function runLoad(callback) {
  isLoading.value = true
  clearMessages()
  try {
    await callback()
  } catch (error) {
    notifyError(friendlyError(error))
  } finally {
    isLoading.value = false
  }
}

async function runAction(callback) {
  isSaving.value = true
  clearMessages()
  try {
    await callback()
  } catch (error) {
    notifyError(friendlyError(error))
  } finally {
    isSaving.value = false
  }
}

function notifySuccess(message) {
  errorMessage.value = ''
  showToast(message)
}

function notifyError(message) {
  errorMessage.value = message
  showToast(message, 'error')
}

function showToast(message, color = 'success') {
  toast.value = { visible: true, message, color }
}

function clearMessages() {
  errorMessage.value = ''
}

function friendlyError(error) {
  const message = error?.message || 'Ocurrió un error inesperado.'
  if (message.includes('UNIQUE constraint failed: Categorias.code')) {
    return 'Ya existe una categoría con ese código.'
  }
  if (message.includes('UNIQUE constraint failed: CategoriaSugerencias')) {
    return 'Esta categoría ya tiene una sugerencia con ese nombre.'
  }
  return message
}

function buildEntityUrl(entity) {
  return buildUrl(
    entity.categoryCode,
    entity.shortCode || entity.token,
    Boolean(entity.shortCode),
  )
}

function buildUrl(categoryCode, token, isShortCode = false) {
  if (isShortCode) return `${PUBLIC_ORIGIN}/${token}`
  return `${PUBLIC_ORIGIN}/${categoryCode || 'CATEGORIA'}/${token}`
}

function safeFileName(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'entidad'
}

function emptyCategory() {
  return { id: null, name: '', code: '', active: true }
}

function emptySuggestion(categoryId = null, sortOrder = 10) {
  return { id: null, categoryId, name: '', active: true, sortOrder, dataType: 'text' }
}

function emptyEntity(categoryId = null) {
  return {
    id: null,
    identification: '',
    categoryId,
    token: '',
    shortCode: '',
    ownerName: '',
    ownerEmail: '',
    ownerPhone: '',
  }
}

function defaultPrintSettings() {
  return {
    format: 'plate',
    qrSizeMm: 60,
    nozzleMm: 0.4,
    baseHeightMm: 2,
    reliefHeightMm: 0.8,
  }
}

function emptyPagination() {
  return { page: 1, pageSize: 10, total: 0, totalPages: 1 }
}
</script>

<template>
  <v-app>
    <main v-if="!authenticated" class="login-page">
      <section class="login-panel">
        <div class="login-brand">
          <span class="login-logo"><ShieldCheck :size="30" /></span>
          <div><strong>Gadget</strong>Design</div>
        </div>
        <div class="login-copy">
          <p class="eyebrow">Administración</p>
          <h1>Acceso protegido</h1>
          <p>Ingresa la contraseña administrativa para continuar.</p>
        </div>
        <form @submit.prevent="login">
          <label class="field">
            <span>Contraseña</span>
            <div class="password-field">
              <KeyRound :size="19" />
              <input
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                autocomplete="current-password"
                autofocus
                maxlength="128"
                placeholder="Contraseña administrativa"
              />
              <button type="button" @click="showPassword = !showPassword">
                {{ showPassword ? 'Ocultar' : 'Ver' }}
              </button>
            </div>
          </label>
          <p v-if="errorMessage" class="alert alert--error">{{ errorMessage }}</p>
          <v-btn
            block
            class="primary-command"
            color="primary"
            :disabled="password.length < 12"
            :loading="isSaving"
            size="large"
            type="submit"
            variant="flat"
          >
            Entrar al administrador
          </v-btn>
        </form>
      </section>
    </main>

    <div v-else class="admin-shell">
      <aside class="sidebar" :class="{ 'sidebar--open': sidebarOpen }">
        <div class="sidebar-brand">
          <span class="sidebar-logo"><Boxes :size="25" /></span>
          <div><strong>Gadget</strong><span>Design</span></div>
          <button class="mobile-close" type="button" aria-label="Cerrar menú" @click="sidebarOpen = false">
            <X :size="22" />
          </button>
        </div>

        <nav aria-label="Administración">
          <button
            v-for="item in navigation"
            :key="item.id"
            type="button"
            :class="{ active: activeView === item.id }"
            @click="navigate(item.id)"
          >
            <component :is="item.icon" :size="20" />
            <span>{{ item.label }}</span>
          </button>
        </nav>

        <div class="sidebar-footer">
          <a href="/" target="_blank"><Link :size="18" /> Ver sitio</a>
          <button type="button" @click="logout"><LogOut :size="18" /> Cerrar sesión</button>
        </div>
      </aside>

      <button
        v-if="sidebarOpen"
        class="sidebar-backdrop"
        type="button"
        aria-label="Cerrar menú"
        @click="sidebarOpen = false"
      />

      <div class="admin-workspace">
        <header class="admin-header">
          <button class="menu-button" type="button" aria-label="Abrir menú" @click="sidebarOpen = true">
            <Menu :size="22" />
          </button>
          <div>
            <p>Panel administrativo</p>
            <h1>{{ pageTitle }}</h1>
          </div>
          <span class="session-badge"><ShieldCheck :size="17" /> Sesión protegida</span>
        </header>

        <section class="admin-content">
          <p v-if="errorMessage" class="alert alert--error">{{ errorMessage }}</p>

          <div v-if="activeView === 'categories'" class="view-section">
            <div class="section-toolbar">
              <div>
                <h2>Catálogo de categorías</h2>
                <p>Los códigos forman parte de la URL pública.</p>
              </div>
              <v-btn color="primary" variant="flat" @click="openCategoryDialog()">
                <Plus :size="19" /> Nueva categoría
              </v-btn>
            </div>

            <div class="data-table">
              <div class="table-head category-grid">
                <span>Categoría</span><span>Código</span><span>Contenido</span><span>Estado</span><span />
              </div>
              <div v-if="isLoading" class="table-empty">Cargando categorías...</div>
              <div v-else-if="!categoryRows.length" class="table-empty">No hay categorías registradas.</div>
              <div v-for="category in categoryRows" :key="category.id" class="table-row category-grid">
                <div class="primary-cell"><span class="cell-icon"><Tag :size="18" /></span><strong>{{ category.name }}</strong></div>
                <code>{{ category.code }}</code>
                <span>{{ category.entityCount }} entidades · {{ category.suggestionCount }} sugerencias</span>
                <span class="status-pill" :class="{ 'status-pill--off': !category.active }">
                  {{ category.active ? 'Activa' : 'Inactiva' }}
                </span>
                <div class="action-cell">
                  <button type="button" title="Editar" @click="openCategoryDialog(category)"><Pencil :size="18" /></button>
                  <button type="button" class="danger" title="Eliminar" @click="removeCategory(category)"><Trash2 :size="18" /></button>
                </div>
              </div>
            </div>
            <div v-if="categoryPagination.total > categoryPagination.pageSize" class="pagination-bar">
              <span>{{ categoryPagination.total }} categorías</span>
              <div>
                <button :disabled="categoryPagination.page <= 1" type="button" aria-label="Página anterior" @click="changeCategoryPage(categoryPagination.page - 1)"><ChevronLeft :size="18" /></button>
                <strong>{{ categoryPagination.page }} / {{ categoryPagination.totalPages }}</strong>
                <button :disabled="categoryPagination.page >= categoryPagination.totalPages" type="button" aria-label="Página siguiente" @click="changeCategoryPage(categoryPagination.page + 1)"><ChevronRight :size="18" /></button>
              </div>
            </div>
          </div>

          <div v-if="activeView === 'suggestions'" class="view-section">
            <div class="section-toolbar">
              <div>
                <h2>Sugerencias por categoría</h2>
                <p>Se muestran únicamente cuando una entidad todavía no tiene datos.</p>
              </div>
              <v-btn :disabled="!selectedCategoryId" color="primary" variant="flat" @click="openSuggestionDialog()">
                <Plus :size="19" /> Nueva sugerencia
              </v-btn>
            </div>
            <label class="filter-field">
              <span>Categoría</span>
              <select v-model="selectedCategoryId" @change="changeSuggestionCategory">
                <option v-for="category in categories" :key="category.id" :value="category.id">
                  {{ category.name }} ({{ category.code }})
                </option>
              </select>
            </label>

            <div class="data-table">
              <div class="table-head suggestion-grid"><span>Sugerencia</span><span>Formato</span><span>Orden</span><span>Estado</span><span /></div>
              <div v-if="isLoading" class="table-empty">Cargando sugerencias...</div>
              <div v-else-if="!suggestions.length" class="table-empty">
                {{ selectedCategory ? `No hay sugerencias para ${selectedCategory.name}.` : 'Selecciona una categoría.' }}
              </div>
              <div v-for="suggestion in suggestions" :key="suggestion.id" class="table-row suggestion-grid">
                <div class="primary-cell"><span class="cell-icon"><Lightbulb :size="18" /></span><strong>{{ suggestion.name }}</strong></div>
                <span>{{ getDataType(suggestion.dataType).label }}</span>
                <span>{{ suggestion.sortOrder }}</span>
                <span class="status-pill" :class="{ 'status-pill--off': !suggestion.active }">
                  {{ suggestion.active ? 'Activa' : 'Inactiva' }}
                </span>
                <div class="action-cell">
                  <button type="button" title="Editar" @click="openSuggestionDialog(suggestion)"><Pencil :size="18" /></button>
                  <button type="button" class="danger" title="Eliminar" @click="removeSuggestion(suggestion)"><Trash2 :size="18" /></button>
                </div>
              </div>
            </div>
            <div v-if="suggestionPagination.total > suggestionPagination.pageSize" class="pagination-bar">
              <span>{{ suggestionPagination.total }} sugerencias</span>
              <div>
                <button :disabled="suggestionPagination.page <= 1" type="button" aria-label="Página anterior" @click="changeSuggestionPage(suggestionPagination.page - 1)"><ChevronLeft :size="18" /></button>
                <strong>{{ suggestionPagination.page }} / {{ suggestionPagination.totalPages }}</strong>
                <button :disabled="suggestionPagination.page >= suggestionPagination.totalPages" type="button" aria-label="Página siguiente" @click="changeSuggestionPage(suggestionPagination.page + 1)"><ChevronRight :size="18" /></button>
              </div>
            </div>
          </div>

          <div v-if="activeView === 'entities'" class="view-section">
            <div class="section-toolbar">
              <div>
                <h2>Entidades y URLs</h2>
                <p>Cada entidad conserva un GUID interno y recibe una URL pública corta.</p>
              </div>
              <v-btn :disabled="!categories.length" color="primary" variant="flat" @click="openEntityDialog()">
                <Plus :size="19" /> Nueva entidad
              </v-btn>
            </div>
            <form class="entity-filters" @submit.prevent="applyEntityFilters">
              <label class="filter-field">
                <span>Categoría</span>
                <select v-model="entityCategoryId">
                  <option :value="null">Todas las categorías</option>
                  <option v-for="category in categories" :key="category.id" :value="category.id">
                    {{ category.name }}
                  </option>
                </select>
              </label>
              <label class="filter-field search-field">
                <span>Buscar</span>
                <div><Search :size="18" /><input v-model="entitySearch" maxlength="200" placeholder="Identificación o código" /></div>
              </label>
              <v-btn class="filter-button" color="primary" type="submit" variant="tonal">Filtrar</v-btn>
            </form>

            <div class="entity-list">
              <div v-if="isLoading" class="table-empty">Cargando entidades...</div>
              <div v-else-if="!entities.length" class="table-empty">No se encontraron entidades.</div>
              <article v-for="entity in entities" :key="entity.id" class="entity-row">
                <div class="entity-identity">
                  <span class="cell-icon"><Users :size="18" /></span>
                  <div>
                    <strong>{{ entity.identification }}</strong>
                    <span>{{ entity.categoryName }} · {{ entity.categoryCode }}</span>
                    <span>{{ entity.ownerEmail || 'Sin correo de acceso' }}</span>
                  </div>
                </div>
                <div class="entity-url">
                  <span>URL pública</span>
                  <a :href="buildEntityUrl(entity)" target="_blank">{{ buildEntityUrl(entity) }}</a>
                </div>
                <div class="action-cell entity-actions">
                  <button type="button" title="Ver código QR" @click="openQr(entity)"><QrCodeIcon :size="18" /></button>
                  <button type="button" title="Preparar impresión 3D" @click="openPrintDialog(entity)"><Printer :size="18" /></button>
                  <button type="button" title="Copiar URL" @click="copyUrl(entity)"><Copy :size="18" /></button>
                  <button type="button" title="Editar" @click="openEntityDialog(entity)"><Pencil :size="18" /></button>
                  <button type="button" title="Regenerar acceso y URL" @click="regenerateToken(entity)"><RefreshCw :size="18" /></button>
                  <button type="button" class="danger" title="Eliminar" @click="removeEntity(entity)"><Trash2 :size="18" /></button>
                </div>
              </article>
            </div>
            <div v-if="entityPagination.total > entityPagination.pageSize" class="pagination-bar">
              <span>{{ entityPagination.total }} entidades</span>
              <div>
                <button :disabled="entityPagination.page <= 1" type="button" aria-label="Página anterior" @click="changeEntityPage(entityPagination.page - 1)"><ChevronLeft :size="18" /></button>
                <strong>{{ entityPagination.page }} / {{ entityPagination.totalPages }}</strong>
                <button :disabled="entityPagination.page >= entityPagination.totalPages" type="button" aria-label="Página siguiente" @click="changeEntityPage(entityPagination.page + 1)"><ChevronRight :size="18" /></button>
              </div>
            </div>
          </div>

          <div v-if="activeView === 'security'" class="view-section security-section">
            <div class="section-toolbar">
              <div>
                <h2>Cambiar contraseña</h2>
                <p>Usa al menos 12 caracteres y evita reutilizar contraseñas.</p>
              </div>
            </div>
            <form class="security-form" @submit.prevent="submitPasswordChange">
              <label class="field"><span>Contraseña actual</span><input v-model="securityForm.currentPassword" type="password" autocomplete="current-password" maxlength="128" /></label>
              <label class="field"><span>Nueva contraseña</span><input v-model="securityForm.newPassword" type="password" autocomplete="new-password" maxlength="128" /></label>
              <label class="field"><span>Confirmar nueva contraseña</span><input v-model="securityForm.confirmPassword" type="password" autocomplete="new-password" maxlength="128" /></label>
              <v-btn color="primary" :loading="isSaving" type="submit" variant="flat"><Save :size="18" /> Actualizar contraseña</v-btn>
            </form>
            <div class="security-note">
              <ShieldCheck :size="22" />
              <p><strong>Importante</strong><span>La contraseña se almacena con PBKDF2, salt aleatorio y 210.000 iteraciones.</span></p>
            </div>
          </div>
        </section>
      </div>
    </div>

    <v-dialog v-model="categoryDialog" max-width="520">
      <v-card class="admin-dialog">
        <div class="dialog-header"><div><Tag :size="21" /><h2>{{ categoryDraft.id ? 'Editar categoría' : 'Nueva categoría' }}</h2></div><button type="button" @click="categoryDialog = false"><X :size="21" /></button></div>
        <form @submit.prevent="submitCategory">
          <label class="field"><span>Nombre</span><input v-model="categoryDraft.name" maxlength="50" placeholder="Ej. Vehículos" /></label>
          <label class="field"><span>Código para la URL</span><input v-model="categoryDraft.code" :maxlength="CATEGORY_CODE_MAX_LENGTH" placeholder="Ej. VEH" @input="categoryDraft.code = categoryDraft.code.toUpperCase()" /></label>
          <label class="switch-field"><input v-model="categoryDraft.active" type="checkbox" /><span><strong>Categoría activa</strong><small>Disponible para nuevas entidades.</small></span></label>
          <div class="dialog-actions"><v-btn variant="text" @click="categoryDialog = false">Cancelar</v-btn><v-btn color="primary" :loading="isSaving" type="submit" variant="flat"><Save :size="18" /> Guardar</v-btn></div>
        </form>
      </v-card>
    </v-dialog>

    <v-dialog v-model="suggestionDialog" max-width="520">
      <v-card class="admin-dialog">
        <div class="dialog-header"><div><Lightbulb :size="21" /><h2>{{ suggestionDraft.id ? 'Editar sugerencia' : 'Nueva sugerencia' }}</h2></div><button type="button" @click="suggestionDialog = false"><X :size="21" /></button></div>
        <form @submit.prevent="submitSuggestion">
          <label class="field"><span>Dato sugerido</span><input v-model="suggestionDraft.name" maxlength="50" placeholder="Ej. Vencimiento SOAT" /></label>
          <label class="field"><span>Tipo de información</span><select v-model="suggestionDraft.dataType"><option v-for="type in CUSTOM_DATA_TYPES" :key="type.value" :value="type.value">{{ type.label }}</option></select></label>
          <label class="field"><span>Orden</span><input v-model.number="suggestionDraft.sortOrder" min="0" max="9999" type="number" /></label>
          <label class="switch-field"><input v-model="suggestionDraft.active" type="checkbox" /><span><strong>Sugerencia activa</strong><small>Visible para entidades sin datos.</small></span></label>
          <div class="dialog-actions"><v-btn variant="text" @click="suggestionDialog = false">Cancelar</v-btn><v-btn color="primary" :loading="isSaving" type="submit" variant="flat"><Save :size="18" /> Guardar</v-btn></div>
        </form>
      </v-card>
    </v-dialog>

    <v-dialog v-model="entityDialog" max-width="620">
      <v-card class="admin-dialog">
        <div class="dialog-header"><div><Users :size="21" /><h2>{{ entityDraft.id ? 'Editar entidad' : 'Nueva entidad' }}</h2></div><button type="button" @click="entityDialog = false"><X :size="21" /></button></div>
        <form @submit.prevent="submitEntity">
          <label class="field"><span>Identificación</span><input v-model="entityDraft.identification" :maxlength="IDENTIFICATION_MAX_LENGTH" placeholder="Ej. ABC-123" /></label>
          <label class="field"><span>Categoría</span><select v-model="entityDraft.categoryId"><option v-for="category in categories" :key="category.id" :value="category.id">{{ category.name }} ({{ category.code }})</option></select></label>
          <label class="field"><span>Nombre del propietario <small>Opcional</small></span><input v-model="entityDraft.ownerName" maxlength="100" autocomplete="name" placeholder="Ej. Carlos Mendoza" /></label>
          <label class="field"><span>Correo de acceso <small>Opcional</small></span><input v-model="entityDraft.ownerEmail" maxlength="254" type="email" autocomplete="email" placeholder="nombre@correo.com" /></label>
          <label class="field"><span>Número de celular <small>Opcional</small></span><input v-model="entityDraft.ownerPhone" maxlength="30" type="tel" autocomplete="tel" placeholder="Ej. +57 300 000 0000" /></label>
          <div class="guid-preview"><ShieldCheck :size="19" /><p><strong>Acceso a modificaciones</strong><span>{{ entityDraft.ownerEmail ? 'El correo recibirá el código para ver datos protegidos y realizar cambios.' : 'Sin correo, la ficha pública permanecerá en modo solo lectura.' }}</span></p></div>
          <div v-if="!entityDraft.id" class="guid-preview"><KeyRound :size="19" /><p><strong>Acceso seguro automático</strong><span>Se generará un GUID interno y un código corto para la URL.</span></p></div>
          <div v-else class="url-preview"><span>URL actual</span><code>{{ buildUrl(categories.find((item) => item.id === Number(entityDraft.categoryId))?.code, entityDraft.shortCode || entityDraft.token, Boolean(entityDraft.shortCode)) }}</code></div>
          <div class="dialog-actions"><v-btn variant="text" @click="entityDialog = false">Cancelar</v-btn><v-btn color="primary" :loading="isSaving" type="submit" variant="flat"><Save :size="18" /> Guardar</v-btn></div>
        </form>
      </v-card>
    </v-dialog>

    <v-dialog v-model="qrDialog" max-width="460">
      <v-card class="admin-dialog qr-dialog">
        <div class="dialog-header">
          <div><QrCodeIcon :size="21" /><h2>Código QR</h2></div>
          <button type="button" aria-label="Cerrar" @click="qrDialog = false"><X :size="21" /></button>
        </div>
        <div v-if="qrEntity" class="qr-content">
          <img :src="qrImageUrl" :alt="`Código QR de ${qrEntity.identification}`" />
          <div>
            <strong>{{ qrEntity.identification }}</strong>
            <a :href="buildEntityUrl(qrEntity)" target="_blank">{{ buildEntityUrl(qrEntity) }}</a>
          </div>
          <v-btn color="primary" variant="flat" @click="openPrintDialog(qrEntity)">
            <Printer :size="18" /> Preparar impresión 3D
          </v-btn>
        </div>
      </v-card>
    </v-dialog>

    <v-dialog v-model="printDialog" max-width="760">
      <v-card class="admin-dialog print-dialog">
        <div class="dialog-header">
          <div><Printer :size="21" /><h2>Preparar impresión 3D</h2></div>
          <button type="button" aria-label="Cerrar" @click="printDialog = false"><X :size="21" /></button>
        </div>
        <div v-if="printEntity && printMetrics" class="print-content">
          <div class="print-summary">
            <div>
              <span>Entidad</span>
              <strong>{{ printEntity.identification }}</strong>
            </div>
            <div>
              <span>Impresora</span>
              <strong>FlashForge AD5X</strong>
            </div>
            <div>
              <span>URL corta</span>
              <code>{{ buildEntityUrl(printEntity) }}</code>
            </div>
          </div>

          <div class="print-controls">
            <label class="field">
              <span>Formato</span>
              <select v-model="printSettings.format">
                <option value="plate">Placa</option>
                <option value="keychain">Llavero con orificio</option>
              </select>
            </label>
            <label class="field">
              <span>Tamaño del QR</span>
              <input
                :value="printSettings.qrSizeMm"
                type="number"
                inputmode="decimal"
                min="10"
                max="200"
                step="1"
                list="qr-print-sizes"
                aria-label="Tamaño del QR en milímetros"
                @input="updateQrSize"
                @blur="restoreQrSize"
              />
              <datalist id="qr-print-sizes">
                <option value="26"></option>
                <option value="50"></option>
                <option value="60"></option>
                <option value="80"></option>
              </datalist>
            </label>
            <label class="field">
              <span>Boquilla</span>
              <select v-model.number="printSettings.nozzleMm">
                <option :value="0.25">0.25 mm · opcional</option>
                <option :value="0.4">0.4 mm · instalada de fábrica</option>
                <option :value="0.6">0.6 mm · opcional</option>
                <option :value="0.8">0.8 mm · opcional</option>
              </select>
            </label>
            <label class="field">
              <span>Grosor de la base</span>
              <select v-model.number="printSettings.baseHeightMm">
                <option :value="1.6">1.6 mm</option>
                <option :value="2">2.0 mm</option>
                <option :value="2.4">2.4 mm</option>
              </select>
            </label>
            <label class="field">
              <span>Altura del relieve</span>
              <select v-model.number="printSettings.reliefHeightMm">
                <option :value="0.6">0.6 mm</option>
                <option :value="0.8">0.8 mm</option>
                <option :value="1.2">1.2 mm</option>
              </select>
            </label>
          </div>

          <div class="print-metrics" :class="{ 'print-metrics--warning': !printMetrics.isPrintable }">
            <Printer :size="22" />
            <div>
              <strong>{{ printMetrics.isPrintable ? 'Configuración lista para imprimir' : 'Módulos demasiado pequeños' }}</strong>
              <span>
                {{ printMetrics.modelWidthMm.toFixed(1) }} × {{ printMetrics.modelHeightMm.toFixed(1) }} mm ·
                módulo {{ printMetrics.moduleSizeMm.toFixed(2) }} mm ·
                recomendado {{ printMetrics.recommendedModuleMm.toFixed(2) }} mm o más
              </span>
              <span v-if="!printMetrics.isPrintable">
                Puedes descargar el modelo, pero conviene usar una boquilla más fina o aumentar el tamaño del QR.
              </span>
            </div>
          </div>

          <p class="print-note">
            Perfil preparado para FlashForge AD5X (cama de 220 × 220 mm). Importa el STL en
            Orca-Flashforge y asigna otro color al relieve o programa el cambio de filamento al comenzar el QR.
          </p>

          <div class="print-actions">
            <v-btn variant="tonal" :disabled="isSaving" @click="downloadPrintSvg">
              <Download :size="18" /> Descargar SVG
            </v-btn>
            <v-btn color="primary" variant="flat" :loading="isSaving" @click="downloadPrintStl">
              <Download :size="18" /> Descargar STL
            </v-btn>
          </div>
        </div>
      </v-card>
    </v-dialog>

    <v-snackbar
      v-model="toast.visible"
      :color="toast.color"
      location="top end"
      :timeout="3200"
    >
      {{ toast.message }}
      <template #actions>
        <v-btn icon variant="text" aria-label="Cerrar notificación" @click="toast.visible = false">
          <X :size="20" />
        </v-btn>
      </template>
    </v-snackbar>
  </v-app>
</template>

<style scoped>
:global(body) { background: #f4f7fb; }
button, input, select { font: inherit; }
button { letter-spacing: 0; }
.login-page { min-height: 100vh; display: grid; place-items: center; padding: 24px; background: linear-gradient(145deg, #eef7ff 0%, #ffffff 50%, #edfaf8 100%); color: #10172a; }
.login-panel { width: min(100%, 440px); padding: 34px; background: #fff; border: 1px solid #dce6f1; border-radius: 8px; box-shadow: 0 22px 60px rgba(35, 62, 98, .14); }
.login-brand { display: flex; align-items: center; gap: 12px; margin-bottom: 38px; color: #090d3f; font-size: 1.35rem; }
.login-logo, .sidebar-logo { display: grid; place-items: center; width: 44px; height: 44px; color: #fff; background: linear-gradient(135deg, #0873ff, #18d5d7); border-radius: 8px; }
.login-copy .eyebrow { margin: 0 0 7px; color: #0873ff; font-size: .78rem; font-weight: 800; text-transform: uppercase; }
.login-copy h1 { margin: 0; font-size: 2rem; letter-spacing: 0; }
.login-copy > p:last-child { margin: 9px 0 26px; color: #66758c; }
.field { display: grid; gap: 7px; color: #34445e; font-size: .88rem; font-weight: 700; }
.field input, .field select, .filter-field select { width: 100%; min-height: 44px; padding: 0 12px; color: #121a2d; background: #fff; border: 1px solid #cdd9e7; border-radius: 6px; outline: 0; }
.field input:focus, .field select:focus, .filter-field select:focus { border-color: #0873ff; box-shadow: 0 0 0 3px rgba(8, 115, 255, .12); }
.password-field { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 9px; padding: 0 12px; border: 1px solid #cdd9e7; border-radius: 6px; }
.password-field:focus-within { border-color: #0873ff; box-shadow: 0 0 0 3px rgba(8, 115, 255, .12); }
.password-field input { padding: 0; border: 0; box-shadow: none; }
.password-field button { color: #0873ff; font-size: .8rem; font-weight: 750; background: transparent; border: 0; cursor: pointer; }
.primary-command { margin-top: 20px; min-height: 46px; text-transform: none; font-weight: 750; }
.admin-shell { min-height: 100vh; color: #111827; background: #f4f7fb; }
.sidebar { position: fixed; inset: 0 auto 0 0; z-index: 30; display: flex; flex-direction: column; width: 244px; padding: 22px 16px; color: #dbe7f5; background: #101a2b; border-right: 1px solid #213149; }
.sidebar-brand { display: flex; align-items: center; gap: 11px; min-height: 52px; padding: 0 8px; color: #fff; font-size: 1.16rem; }
.sidebar-brand div:nth-child(2) { display: flex; }
.sidebar-brand span { font-weight: 400; }
.sidebar-logo { width: 38px; height: 38px; border-radius: 7px; }
.sidebar nav { display: grid; gap: 5px; margin-top: 35px; }
.sidebar nav button, .sidebar-footer button, .sidebar-footer a { display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 0 13px; color: #aebed2; text-decoration: none; background: transparent; border: 0; border-radius: 6px; cursor: pointer; }
.sidebar nav button:hover, .sidebar nav button.active { color: #fff; background: #1c2c43; }
.sidebar nav button.active { box-shadow: inset 3px 0 #25c7d2; }
.sidebar-footer { display: grid; gap: 5px; margin-top: auto; padding-top: 20px; border-top: 1px solid #27364b; }
.sidebar-footer button:hover, .sidebar-footer a:hover { color: #fff; }
.mobile-close, .menu-button { display: none; }
.admin-workspace { min-height: 100vh; margin-left: 244px; }
.admin-header { display: flex; align-items: center; gap: 14px; min-height: 86px; padding: 17px 32px; background: #fff; border-bottom: 1px solid #dfe7f0; }
.admin-header p { margin: 0 0 2px; color: #718097; font-size: .76rem; font-weight: 750; text-transform: uppercase; }
.admin-header h1 { margin: 0; font-size: 1.55rem; line-height: 1.15; }
.session-badge { display: flex; align-items: center; gap: 7px; margin-left: auto; padding: 8px 10px; color: #16795b; font-size: .82rem; font-weight: 700; background: #eaf8f2; border: 1px solid #ccecdf; border-radius: 6px; }
.admin-content { width: min(100%, 1240px); margin: 0 auto; padding: 30px 32px 60px; }
.section-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 22px; }
.section-toolbar h2 { margin: 0; font-size: 1.25rem; }
.section-toolbar p { margin: 5px 0 0; color: #69788e; }
.section-toolbar :deep(.v-btn), .dialog-actions :deep(.v-btn), .security-form :deep(.v-btn) { text-transform: none; font-weight: 700; letter-spacing: 0; }
.section-toolbar :deep(.v-btn__content), .dialog-actions :deep(.v-btn__content), .security-form :deep(.v-btn__content) { gap: 8px; }
.alert { display: flex; align-items: center; gap: 9px; margin: 0 0 18px; padding: 12px 14px; border-radius: 6px; font-weight: 650; }
.alert--error { color: #a41924; background: #fff0f1; border: 1px solid #ffcfd3; }
.alert--success { color: #166b51; background: #eaf8f2; border: 1px solid #c7eadc; }
.data-table, .entity-list { overflow: hidden; background: #fff; border: 1px solid #dce5ef; border-radius: 7px; }
.table-head, .table-row { display: grid; align-items: center; gap: 18px; padding: 0 18px; }
.table-head { min-height: 45px; color: #6c7a90; font-size: .76rem; font-weight: 800; text-transform: uppercase; background: #f7f9fc; border-bottom: 1px solid #dce5ef; }
.table-row { min-height: 66px; color: #4e5d73; border-bottom: 1px solid #e5ebf2; }
.table-row:last-child { border-bottom: 0; }
.category-grid { grid-template-columns: minmax(170px, 1.2fr) minmax(90px, .55fr) minmax(180px, 1fr) 90px 88px; }
.suggestion-grid { grid-template-columns: minmax(210px, 1fr) 150px 80px 100px 88px; }
.primary-cell { display: flex; align-items: center; gap: 10px; min-width: 0; color: #172033; }
.primary-cell strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cell-icon { display: grid; width: 34px; height: 34px; flex: 0 0 auto; place-items: center; color: #0873ff; background: #edf6ff; border-radius: 6px; }
.table-row code { width: fit-content; padding: 4px 7px; color: #264b7c; background: #eef4fa; border-radius: 4px; }
.status-pill { width: fit-content; padding: 5px 8px; color: #157255; font-size: .78rem; font-weight: 750; background: #e7f7f0; border-radius: 999px; }
.status-pill--off { color: #68778b; background: #edf1f5; }
.action-cell { display: flex; justify-content: flex-end; gap: 6px; }
.action-cell button { display: grid; width: 34px; height: 34px; place-items: center; color: #3f5f86; background: #fff; border: 1px solid #d8e2ed; border-radius: 6px; cursor: pointer; }
.action-cell button:hover { color: #0873ff; border-color: #9fc8f9; }
.action-cell button.danger { color: #d62d3b; background: #fff5f5; border-color: #ffd6da; }
.table-empty { padding: 38px 20px; color: #748298; text-align: center; }
.pagination-bar { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 12px; color: #68778c; font-size: .84rem; }
.pagination-bar > div { display: flex; align-items: center; gap: 8px; }
.pagination-bar button { display: grid; width: 36px; height: 36px; place-items: center; color: #31567f; background: #fff; border: 1px solid #d4dfeb; border-radius: 6px; cursor: pointer; }
.pagination-bar button:disabled { color: #a8b3c2; background: #f2f5f8; cursor: default; }
.pagination-bar strong { min-width: 54px; color: #34445e; text-align: center; }
.filter-field { display: grid; gap: 6px; width: min(100%, 340px); margin-bottom: 18px; color: #4b5b72; font-size: .82rem; font-weight: 750; }
.entity-filters { display: grid; grid-template-columns: 240px minmax(240px, 1fr) auto; gap: 12px; align-items: end; margin-bottom: 18px; padding: 15px; background: #fff; border: 1px solid #dce5ef; border-radius: 7px; }
.entity-filters .filter-field { width: 100%; margin: 0; }
.search-field > div { display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 11px; background: #fff; border: 1px solid #cdd9e7; border-radius: 6px; }
.search-field input { width: 100%; min-width: 0; border: 0; outline: 0; }
.filter-button { min-height: 44px; }
.entity-row { display: grid; grid-template-columns: minmax(180px, .8fr) minmax(300px, 1.4fr) auto; gap: 20px; align-items: center; min-height: 86px; padding: 12px 18px; border-bottom: 1px solid #e5ebf2; }
.entity-row:last-child { border-bottom: 0; }
.entity-identity { display: flex; align-items: center; gap: 11px; min-width: 0; }
.entity-identity > div { display: grid; min-width: 0; }
.entity-identity strong { overflow: hidden; color: #172033; text-overflow: ellipsis; white-space: nowrap; }
.entity-identity span:last-child { color: #748298; font-size: .82rem; }
.entity-url { display: grid; gap: 4px; min-width: 0; }
.entity-url span { color: #748298; font-size: .76rem; font-weight: 750; text-transform: uppercase; }
.entity-url a { overflow: hidden; color: #096bdc; font-size: .86rem; text-overflow: ellipsis; white-space: nowrap; }
.security-section { max-width: 720px; }
.security-form { display: grid; gap: 17px; padding: 22px; background: #fff; border: 1px solid #dce5ef; border-radius: 7px; }
.security-form :deep(.v-btn) { width: fit-content; }
.security-note, .guid-preview { display: flex; align-items: flex-start; gap: 12px; margin-top: 16px; padding: 15px; color: #3d5678; background: #edf6ff; border: 1px solid #d4e8fb; border-radius: 7px; }
.security-note p, .guid-preview p { display: grid; gap: 3px; margin: 0; }
.security-note span, .guid-preview span { color: #62748e; font-size: .88rem; }
.admin-dialog { padding: 0; border-radius: 8px !important; }
.dialog-header { display: flex; align-items: center; justify-content: space-between; padding: 18px 20px; border-bottom: 1px solid #e0e7ef; }
.dialog-header > div { display: flex; align-items: center; gap: 10px; }
.dialog-header h2 { margin: 0; font-size: 1.15rem; }
.dialog-header button { display: grid; width: 34px; height: 34px; place-items: center; background: transparent; border: 0; border-radius: 5px; cursor: pointer; }
.admin-dialog form { display: grid; gap: 17px; padding: 20px; }
.switch-field { display: flex; align-items: center; gap: 11px; }
.switch-field input { width: 18px; height: 18px; accent-color: #0873ff; }
.switch-field span { display: grid; }
.switch-field small { color: #718097; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 5px; }
.url-preview { display: grid; gap: 7px; padding: 13px; background: #f4f7fa; border: 1px solid #dce5ef; border-radius: 6px; }
.url-preview span { color: #68778c; font-size: .8rem; font-weight: 750; }
.url-preview code { overflow-wrap: anywhere; color: #174b88; }
.qr-content { display: grid; justify-items: center; gap: 18px; padding: 22px; }
.qr-content img { width: min(100%, 320px); aspect-ratio: 1; object-fit: contain; background: #fff; border: 1px solid #dce5ef; border-radius: 6px; }
.qr-content > div { display: grid; gap: 5px; max-width: 100%; text-align: center; }
.qr-content a { max-width: 100%; color: #096bdc; font-size: .84rem; overflow-wrap: anywhere; }
.qr-content :deep(.v-btn) { text-transform: none; font-weight: 700; letter-spacing: 0; }
.qr-content :deep(.v-btn__content) { gap: 8px; }
.print-content { display: grid; gap: 20px; padding: 22px; }
.print-summary { display: grid; grid-template-columns: minmax(130px, .45fr) minmax(0, 1fr); gap: 14px; padding: 14px; background: #f4f7fa; border: 1px solid #dce5ef; border-radius: 7px; }
.print-summary > div { display: grid; gap: 4px; min-width: 0; }
.print-summary > div:last-child { grid-column: 1 / -1; }
.print-summary span { color: #68778c; font-size: .76rem; font-weight: 750; text-transform: uppercase; }
.print-summary code { overflow: hidden; color: #174b88; font-size: .82rem; text-overflow: ellipsis; white-space: nowrap; }
.print-controls { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.print-metrics { display: flex; align-items: flex-start; gap: 12px; padding: 14px; color: #166b51; background: #eaf8f2; border: 1px solid #c7eadc; border-radius: 7px; }
.print-metrics--warning { color: #9a5b0c; background: #fff7e8; border-color: #f3d49f; }
.print-metrics > div { display: grid; gap: 3px; }
.print-metrics span { font-size: .84rem; line-height: 1.4; }
.print-note { margin: 0; color: #617189; font-size: .86rem; line-height: 1.45; }
.print-actions { display: flex; justify-content: flex-end; gap: 10px; }
.print-actions :deep(.v-btn) { text-transform: none; font-weight: 700; letter-spacing: 0; }
.print-actions :deep(.v-btn__content) { gap: 8px; }
.sidebar-backdrop { display: none; }

@media (max-width: 980px) {
  .sidebar { transform: translateX(-100%); transition: transform .2s ease; }
  .sidebar--open { transform: translateX(0); }
  .mobile-close { display: grid; width: 36px; height: 36px; margin-left: auto; place-items: center; color: #dbe7f5; background: transparent; border: 0; }
  .sidebar-backdrop { position: fixed; inset: 0; z-index: 20; display: block; background: rgba(8, 15, 27, .45); border: 0; }
  .admin-workspace { margin-left: 0; }
  .menu-button { display: grid; width: 40px; height: 40px; flex: 0 0 auto; place-items: center; color: #33455f; background: #f4f7fb; border: 1px solid #dce5ef; border-radius: 6px; }
  .entity-row { grid-template-columns: minmax(180px, .7fr) minmax(260px, 1.2fr); }
  .entity-actions { grid-column: 1 / -1; justify-content: flex-start; }
}

@media (max-width: 720px) {
  .admin-header { min-height: 76px; padding: 13px 16px; }
  .admin-header h1 { font-size: 1.3rem; }
  .session-badge { width: 38px; height: 38px; padding: 0; justify-content: center; }
  .session-badge { font-size: 0; }
  .admin-content { padding: 22px 14px 46px; }
  .print-content { padding: 16px; }
  .print-summary, .print-controls { grid-template-columns: 1fr; }
  .print-summary > div:last-child { grid-column: auto; }
  .print-actions { display: grid; }
  .section-toolbar { flex-direction: column; align-items: stretch; gap: 14px; }
  .section-toolbar :deep(.v-btn) { width: 100%; min-width: 42px; padding: 0 12px; }
  .category-grid, .suggestion-grid { grid-template-columns: 1fr auto; }
  .table-head span:nth-child(n+2):not(:last-child) { display: none; }
  .table-row { min-height: 72px; padding: 12px; }
  .table-row.category-grid, .table-row.suggestion-grid { align-items: start; gap: 6px 12px; }
  .table-row.category-grid > :nth-child(1), .table-row.suggestion-grid > :nth-child(1) { grid-column: 1; grid-row: 1; }
  .table-row.category-grid > :nth-child(2) { display: block; grid-column: 1; grid-row: 2; margin-left: 44px; }
  .table-row.category-grid > :nth-child(3) { display: block; grid-column: 1; grid-row: 3; margin-left: 44px; font-size: .82rem; }
  .table-row.category-grid > :nth-child(4) { display: block; grid-column: 1; grid-row: 4; margin: 2px 0 0 44px; }
  .table-row.category-grid > :nth-child(5), .table-row.suggestion-grid > :nth-child(5) { grid-column: 2; grid-row: 1 / span 4; align-self: center; }
  .table-row.suggestion-grid > :nth-child(2) { display: block; grid-column: 1; grid-row: 2; margin-left: 44px; color: #748298; font-size: .82rem; }
  .table-row.suggestion-grid > :nth-child(3) { display: block; grid-column: 1; grid-row: 3; margin-left: 44px; color: #748298; font-size: .82rem; }
  .table-row.suggestion-grid > :nth-child(3)::before { content: "Orden: "; }
  .table-row.suggestion-grid > :nth-child(4) { display: block; grid-column: 1; grid-row: 4; margin: 2px 0 0 44px; }
  .entity-filters { grid-template-columns: 1fr; }
  .filter-button { width: 100%; }
  .entity-row { grid-template-columns: 1fr; gap: 11px; }
  .entity-actions { grid-column: auto; }
  .entity-url a { white-space: normal; overflow-wrap: anywhere; }
  .login-panel { padding: 26px 22px; }
}
</style>
