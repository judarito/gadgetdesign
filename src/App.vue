<script setup>
import { computed, h, onMounted, ref } from 'vue'
import { CalendarDays, LockKeyhole, LogOut, Mail, ShieldCheck } from '@lucide/vue'
import {
  CUSTOM_DATA_LIMIT,
  createCustomData,
  deleteCustomData,
  fetchEntity,
  getRouteContext,
  logoutEntityAccess,
  requestEntityAccessCode,
  updateCustomData,
  verifyEntityAccessCode,
} from './services/entityApi'
import {
  CUSTOM_DATA_KEY_MAX_LENGTH,
  IDENTIFICATION_MAX_LENGTH,
} from './services/validation'
import { CUSTOM_DATA_TYPES, formatCustomDataValue, getDataType } from './services/dataTypes'

const routeContext = getRouteContext()
const category = ref(null)
const entity = ref(null)
const customData = ref([])
const suggestions = ref([])
const savedDrafts = ref([])
const suggestionDrafts = ref([])
const selectedSuggestionId = ref(null)
const newDraft = ref({ key: '', value: '', dataType: 'text', protected: false })
const auth = ref({ authorized: false, canRequestCode: false, emailHint: '' })
const accessDialog = ref(false)
const accessCode = ref('')
const isLoading = ref(false)
const isSaving = ref(false)
const savingKey = ref(null)
const editingId = ref(null)
const errorMessage = ref('')
const toast = ref({ visible: false, message: '', color: 'success' })

const canUseCrud = computed(() =>
  routeContext.isValid && auth.value.authorized && !isLoading.value && !isSaving.value,
)
const isAtCustomDataLimit = computed(() => customData.value.length >= CUSTOM_DATA_LIMIT)
const identifierText = computed(() => entity.value?.identificacion || 'Sin datos')
const categoryCopy = computed(() => getCategoryCopy(category.value))
const helperText = computed(() => {
  if (isAtCustomDataLimit.value) return `Límite alcanzado: ${CUSTOM_DATA_LIMIT} datos personalizados.`

  return `${customData.value.length}/${CUSTOM_DATA_LIMIT} datos guardados.`
})
const showSuggestions = computed(() => suggestionDrafts.value.length > 0)
const selectedSuggestion = computed(() =>
  suggestionDrafts.value.find((draft) => draft.id === selectedSuggestionId.value),
)

const paths = {
  user: [
    'M20 52c0-8.8 7.2-16 16-16s16 7.2 16 16v4H20v-4Z',
    'M36 32c-6.6 0-12-5.4-12-12S29.4 8 36 8s12 5.4 12 12-5.4 12-12 12Z',
  ],
  car: [
    'M14 35h4l4-11h28l4 11h4v17h-8v-5H22v5h-8V35Z',
    'M24 29h24l-2-6H26l-2 6Z',
    'M23 41a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM49 41a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  ],
  paw: [
    'M22 27c-3.2.8-6.5-2.1-7.4-6.4-.9-4.4 1-8.4 4.2-9.1 3.2-.8 6.5 2.1 7.4 6.4.9 4.4-1 8.4-4.2 9.1Z',
    'M42 27c3.2.8 6.5-2.1 7.4-6.4.9-4.4-1-8.4-4.2-9.1-3.2-.8-6.5 2.1-7.4 6.4-.9 4.4 1 8.4 4.2 9.1Z',
    'M14.2 39.5c-3.4-1.2-4.8-5.7-3.1-9.9 1.7-4.3 5.8-6.8 9.2-5.5 3.4 1.2 4.8 5.7 3.1 9.9-1.7 4.3-5.8 6.8-9.2 5.5Z',
    'M49.8 39.5c3.4-1.2 4.8-5.7 3.1-9.9-1.7-4.3-5.8-6.8-9.2-5.5-3.4 1.2-4.8 5.7-3.1 9.9 1.7 4.3 5.8 6.8 9.2 5.5Z',
    'M22 48c0-7.2 5.6-14 10-14s10 6.8 10 14c0 4.6-4.5 6.4-10 6.4S22 52.6 22 48Z',
  ],
  file: [
    'M18 8h22l10 10v38H18V8Z',
    'M39 8v12h11',
    'M25 30h22M25 39h22M25 48h13',
  ],
  palette: [
    'M34 8C20.2 8 9 18.5 9 31.5S19.5 55 32.5 55h4.1c3.5 0 5.4-4 3.3-6.8-.9-1.2-.1-3 1.4-3H47c8.1 0 14-6.4 14-14.2C61 18.2 49 8 34 8Z',
    'M23 28a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM34 22a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM44 30a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM31 43a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  ],
  trash: [
    'M20 22h32M27 22v30h18V22M29 22l2-8h10l2 8',
    'M32 30v14M40 30v14',
  ],
  edit: [
    'M14 47.5 17.5 36 43 10.5a5.7 5.7 0 0 1 8 8L25.5 44 14 47.5Z',
    'M37 16.5 44.5 24',
  ],
  close: ['M18 18 46 46', 'M46 18 18 46'],
  save: ['M16 10h29l8 8v36H11V10h5Z', 'M20 10v15h24V10M20 54V36h24v18'],
}

const AppIcon = {
  props: {
    name: {
      type: String,
      required: true,
    },
  },
  setup(props) {
    return () =>
      h(
        'svg',
        {
          viewBox: '0 0 64 64',
          role: 'img',
          focusable: 'false',
        },
        (paths[props.name] || paths.user).map((path) =>
          h('path', {
            d: path,
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': 5.6,
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
          }),
        ),
      )
  },
}

onMounted(loadEntity)

async function loadEntity() {
  if (!routeContext.isValid) {
    errorMessage.value = 'Abre una URL válida de Gadget Design.'
    return
  }

  await runRequest(async () => {
    applyContext(await fetchEntity(routeContext.categoryCode, routeContext.token))
  }, true)
}

async function saveNewDraft(draft, requestKey) {
  if (!draft.key.trim() || !draft.value.trim() || !canUseCrud.value || isAtCustomDataLimit.value) {
    return
  }

  await runRequest(async () => {
    applyContext(
      await createCustomData(routeContext.categoryCode, routeContext.token, {
        key: draft.key,
        value: draft.value,
        dataType: draft.dataType,
        suggestionId: draft.suggestionId,
        protected: draft.protected,
      }),
    )
  }, false, requestKey, 'Dato agregado correctamente.')
}

function selectSuggestion(draft) {
  if (!auth.value.authorized) {
    requestProtectedAccess()
    return
  }
  if (!canUseCrud.value) return
  if (selectedSuggestionId.value !== draft.id) resetSelectedSuggestion()
  selectedSuggestionId.value = draft.id
}

function requestProtectedAccess() {
  if (auth.value.authorized) return

  if (!auth.value.canRequestCode) {
    showToast('Esta ficha está en modo solo lectura porque no tiene un correo configurado.', 'error')
    return
  }

  requestAccess()
}

function runProtectedAction(action) {
  if (!auth.value.authorized) {
    requestProtectedAccess()
    return
  }

  action()
}

function closeSuggestionEditor() {
  resetSelectedSuggestion()
  selectedSuggestionId.value = null
}

function openDatePicker(event, dataType) {
  if (dataType !== 'date') return

  showNativeDatePicker(event.currentTarget)
}

function openDatePickerFromTrigger(event) {
  const input = event.currentTarget.parentElement?.querySelector('input[type="date"]')
  input?.focus({ preventScroll: true })
  showNativeDatePicker(input)
}

function showNativeDatePicker(input) {
  if (typeof input?.showPicker !== 'function') return

  try {
    input.showPicker()
  } catch {
    // Browsers without an invokable native picker keep their default date behavior.
  }
}

function resetSelectedSuggestion() {
  const draft = selectedSuggestion.value
  const source = suggestions.value.find((suggestion) => suggestion.id === draft?.id)
  if (!draft || !source) return
  Object.assign(draft, source, { suggestionId: Number(source.id), value: '', protected: false })
}

async function saveExistingDraft(draft) {
  if (!draft.key.trim() || !draft.value.trim() || !canUseCrud.value) return

  await runRequest(async () => {
    applyContext(
      await updateCustomData(routeContext.categoryCode, routeContext.token, draft.id, {
        key: draft.key,
        value: draft.value,
        dataType: draft.dataType,
        protected: draft.protected,
      }),
    )
  }, false, `saved-${draft.id}`, 'Dato actualizado correctamente.')
}

function startEdit(draft) {
  restoreDraft(editingId.value)
  editingId.value = draft.id
}

function cancelEdit(draft) {
  restoreDraft(draft.id)
  editingId.value = null
}

function restoreDraft(itemId) {
  if (!itemId) return
  const source = customData.value.find((item) => item.id === itemId)
  const draft = savedDrafts.value.find((item) => item.id === itemId)
  if (source && draft) Object.assign(draft, source)
}

async function removeCustomData(item) {
  if (!canUseCrud.value) return

  await runRequest(async () => {
    applyContext(await deleteCustomData(routeContext.categoryCode, routeContext.token, item.id))
  }, false, `delete-${item.id}`, 'Dato eliminado correctamente.')
}

function applyContext(context) {
  category.value = context.category
  entity.value = context.entity
  customData.value = context.entity?.customData || []
  suggestions.value = context.suggestions || []
  auth.value = context.auth || { authorized: false, canRequestCode: false, emailHint: '' }
  savedDrafts.value = customData.value.map((item) => ({ ...item }))
  editingId.value = null
  const usedSuggestionIds = new Set(
    customData.value.map((item) => item.suggestionId).filter(Boolean),
  )
  suggestionDrafts.value = suggestions.value
    .filter(
      (suggestion) =>
        !usedSuggestionIds.has(Number(suggestion.id)) &&
        !customData.value.some((item) => isEquivalentKey(suggestion.key, item.key)),
    )
    .map((suggestion) => ({
      ...suggestion,
      suggestionId: Number(suggestion.id),
      value: '',
      protected: false,
    }))
  selectedSuggestionId.value = null
  newDraft.value = { key: '', value: '', dataType: 'text', protected: false }
}

async function requestAccess() {
  await runRequest(async () => {
    const result = await requestEntityAccessCode(routeContext.categoryCode, routeContext.token)
    auth.value.emailHint = result.emailHint
    accessCode.value = ''
    accessDialog.value = true
  }, false, 'request-access', `Enviamos un código a ${auth.value.emailHint}.`)
}

async function verifyAccess() {
  if (!/^\d{6}$/.test(accessCode.value)) return
  await runRequest(async () => {
    applyContext(
      await verifyEntityAccessCode(
        routeContext.categoryCode,
        routeContext.token,
        accessCode.value,
      ),
    )
    accessDialog.value = false
  }, false, 'verify-access', 'Acceso verificado correctamente.')
}

async function closeAccess() {
  await logoutEntityAccess().catch(() => {})
  accessDialog.value = false
  await loadEntity()
  showToast('Sesión cerrada.')
}

async function runRequest(callback, initialLoad = false, requestKey = null, successMessage = '') {
  errorMessage.value = ''
  isLoading.value = initialLoad
  isSaving.value = !initialLoad
  savingKey.value = requestKey

  try {
    await callback()
    if (successMessage) showToast(successMessage)
  } catch (error) {
    errorMessage.value = error.message || 'Ocurrió un error inesperado.'
    if (!initialLoad) showToast(errorMessage.value, 'error')
  } finally {
    isLoading.value = false
    isSaving.value = false
    savingKey.value = null
  }
}

function showToast(message, color = 'success') {
  toast.value = { visible: true, message, color }
}

function getIconForKey(key) {
  const normalizedKey = key.toLowerCase()

  if (normalizedKey.includes('placa') || normalizedKey.includes('carro')) return 'car'
  if (normalizedKey.includes('tipo') || normalizedKey.includes('raza')) return 'paw'
  if (normalizedKey.includes('color')) return 'palette'
  if (normalizedKey.includes('propietario') || normalizedKey.includes('persona')) return 'user'

  return 'file'
}

function normalizeKey(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('es')
}

function isEquivalentKey(suggestionKey, savedKey) {
  const normalizedSuggestion = normalizeKey(suggestionKey)
  const normalizedSaved = normalizeKey(savedKey)
  if (normalizedSuggestion === normalizedSaved) return true

  const suggestionTokens = getComparableTokens(normalizedSuggestion)
  const savedTokens = getComparableTokens(normalizedSaved)
  if (!suggestionTokens.length || !savedTokens.length) return false

  return (
    savedTokens.length >= suggestionTokens.length - 1 &&
    savedTokens.every((token) => suggestionTokens.includes(token))
  )
}

function getComparableTokens(value) {
  const ignoredWords = new Set(['de', 'del', 'el', 'la', 'los', 'las', 'y', 'para'])

  return value
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !ignoredWords.has(word))
    .map((word) => (word.length >= 5 ? word.slice(0, 4) : word))
}

function getCategoryCopy(currentCategory) {
  const categoryCode = String(currentCategory?.code || '').trim().toUpperCase()
  const normalizedName = normalizeKey(currentCategory?.name || '')
  const subjects = {
    VEH: 'vehículo',
    vehiculo: 'vehículo',
    vehiculos: 'vehículo',
    mascota: 'mascota',
    mascotas: 'mascota',
    persona: 'persona',
    personas: 'persona',
    equipo: 'equipo',
    equipos: 'equipo',
    objeto: 'objeto',
    objetos: 'objeto',
  }
  const subject = subjects[categoryCode] || subjects[normalizedName]

  if (subject) {
    return {
      title: `Datos de tu ${subject}`,
      newData: `Puedes agregar un nuevo dato para tu ${subject}.`,
    }
  }

  const categoryName = String(currentCategory?.name || '').trim()
  if (categoryName) {
    return {
      title: `Datos de ${categoryName}`,
      newData: `Puedes agregar un nuevo dato para la categoría ${categoryName}.`,
    }
  }

  return {
    title: 'Datos de tu identificación',
    newData: 'Puedes agregar un nuevo dato a esta identificación.',
  }
}
</script>

<template>
  <v-app>
    <div class="app-shell">
      <header class="topbar">
        <div class="topbar-inner">
          <a class="brand" href="#" aria-label="Gadget Design">
            <span class="brand-mark brand-mark--small" aria-hidden="true">
              <span class="brand-arm brand-arm--top" />
              <span class="brand-arm brand-arm--bottom" />
            </span>
            <span class="brand-word">
              <strong>Gadget</strong>
              <span>Design</span>
            </span>
          </a>

          <v-btn class="qr-button" icon variant="flat" aria-label="Escanear código QR">
            <svg class="qr-glyph" viewBox="0 0 32 32" aria-hidden="true">
              <path d="M6 12V6h6M20 6h6v6M26 20v6h-6M12 26H6v-6" />
              <path d="M10 10h2M20 10h2M10 20h2M20 20h2M15 15h2M14 22h2M22 15h2M17 9h2M9 15h2" />
            </svg>
          </v-btn>
        </div>
      </header>

      <v-main class="main-area">
        <section class="content">
          <div class="headline">
            <h1>Información útil, siempre a mano</h1>
            <p>Consulta y actualiza los datos vinculados a este código QR</p>
          </div>

          <v-sheet class="id-card" rounded="xl" border>
            <h2>Identificador</h2>
            <div class="identifier-pill">
              <span class="tag-icon" aria-hidden="true">
                <svg viewBox="0 0 64 64" role="img">
                  <path d="M7.9 33.9 33.8 8h18.7a3.5 3.5 0 0 1 3.5 3.5v18.7L30.1 56.1a5 5 0 0 1-7.1 0L7.9 41a5 5 0 0 1 0-7.1Z" />
                  <circle cx="45" cy="19" r="5.2" fill="#dff0ff" />
                </svg>
              </span>
              <strong>{{ identifierText }}</strong>
            </div>
          </v-sheet>

          <v-sheet class="data-card" rounded="xl" border>
            <div class="section-title">
              <span class="square-icon" aria-hidden="true">
                <AppIcon name="user" />
              </span>
              <div>
                <h2>{{ categoryCopy.title }}</h2>
                <p>Consulta y administra la información guardada</p>
              </div>
            </div>

            <div v-if="entity && !isLoading" class="access-panel" :class="{ 'access-panel--verified': auth.authorized }">
              <component :is="auth.authorized ? ShieldCheck : LockKeyhole" :size="22" />
              <div>
                <strong>{{ auth.authorized ? 'Acceso verificado' : 'Información protegida' }}</strong>
                <span v-if="auth.authorized">Puedes ver datos protegidos y administrar esta ficha durante 8 horas.</span>
                <span v-else-if="auth.canRequestCode">Valida el código enviado a {{ auth.emailHint }} para ver datos protegidos o realizar cambios.</span>
                <span v-else>Esta ficha está en modo solo lectura hasta que el administrador configure un correo.</span>
              </div>
              <v-btn
                v-if="auth.authorized"
                class="access-button"
                variant="tonal"
                @click="closeAccess"
              >
                <LogOut :size="17" /> Salir
              </v-btn>
              <v-btn
                v-else-if="auth.canRequestCode"
                class="access-button"
                color="primary"
                :loading="savingKey === 'request-access'"
                variant="flat"
                @click="requestAccess"
              >
                <Mail :size="17" /> Enviar código
              </v-btn>
            </div>

            <div v-if="errorMessage" class="status-message status-message--error">
              {{ errorMessage }}
            </div>

            <div v-if="isLoading" class="status-message">Cargando información...</div>

            <div v-if="!isLoading" class="inline-header">
              <span>{{ helperText }}</span>
              <span>Dato y Valor son obligatorios.</span>
            </div>

            <section v-if="showSuggestions && !isLoading" class="suggestions-panel">
              <div class="suggestions-heading">
                <h3>Sugerencias para {{ category?.name || 'esta categoría' }}</h3>
                <p>Selecciona una para agregarla.</p>
              </div>
              <div class="suggestion-options" aria-label="Sugerencias disponibles">
                <button
                  v-for="draft in suggestionDrafts"
                  :key="draft.id"
                  class="suggestion-option"
                  :class="{
                    'suggestion-option--selected': selectedSuggestionId === draft.id,
                    'suggestion-option--locked': !auth.authorized,
                  }"
                  :disabled="isLoading || isSaving || (!auth.authorized && !auth.canRequestCode)"
                  type="button"
                  @click="selectSuggestion(draft)"
                >
                  <LockKeyhole v-if="!auth.authorized" :size="14" aria-hidden="true" />
                  {{ draft.key }}
                </button>
              </div>
              <form
                v-if="selectedSuggestion"
                class="inline-row inline-row--suggestion"
                @submit.prevent="saveNewDraft(selectedSuggestion, `suggestion-${selectedSuggestion.id}`)"
              >
                <label>
                  <span>Dato <small>{{ getDataType(selectedSuggestion.dataType).label }}</small></span>
                  <input
                    v-model="selectedSuggestion.key"
                    :disabled="!canUseCrud"
                    :maxlength="CUSTOM_DATA_KEY_MAX_LENGTH"
                    aria-label="Dato sugerido"
                  />
                </label>
                <label>
                  <span>Valor</span>
                  <div class="value-input-shell" :class="{ 'value-input-shell--date': selectedSuggestion.dataType === 'date' }">
                    <input
                      v-model="selectedSuggestion.value"
                      :type="getDataType(selectedSuggestion.dataType).inputType"
                      :disabled="!canUseCrud"
                      :maxlength="IDENTIFICATION_MAX_LENGTH"
                      :placeholder="getDataType(selectedSuggestion.dataType).placeholder"
                      aria-label="Valor del dato sugerido"
                      @pointerdown.capture="openDatePicker($event, selectedSuggestion.dataType)"
                    />
                    <button
                      v-if="selectedSuggestion.dataType === 'date'"
                      class="date-picker-trigger"
                      type="button"
                      tabindex="-1"
                      aria-label="Abrir selector de fecha"
                      @click="openDatePickerFromTrigger"
                    />
                    <CalendarDays v-if="selectedSuggestion.dataType === 'date'" class="date-picker-icon" :size="19" aria-hidden="true" />
                  </div>
                </label>
                <label class="protection-toggle">
                  <input v-model="selectedSuggestion.protected" type="checkbox" />
                  <span><LockKeyhole :size="16" /> Proteger valor</span>
                </label>
                <div class="suggestion-actions">
                  <v-btn
                    class="save-button"
                    color="primary"
                    :disabled="!canUseCrud || !selectedSuggestion.key.trim() || !selectedSuggestion.value.trim()"
                    :loading="savingKey === `suggestion-${selectedSuggestion.id}`"
                    type="submit"
                    variant="flat"
                  >
                    <AppIcon name="save" />
                    Guardar
                  </v-btn>
                  <v-btn
                    class="cancel-button"
                    icon
                    :disabled="!canUseCrud"
                    type="button"
                    variant="flat"
                    aria-label="Cerrar sugerencia"
                    @click="closeSuggestionEditor"
                  >
                    <AppIcon name="close" />
                  </v-btn>
                </div>
              </form>
            </section>

            <div v-if="savedDrafts.length" class="data-list" aria-label="Datos personalizados guardados">
              <form
                v-for="draft in savedDrafts"
                :key="draft.id"
                class="inline-row data-row"
                @submit.prevent="saveExistingDraft(draft)"
              >
                <span class="row-icon" aria-hidden="true">
                  <AppIcon :name="getIconForKey(draft.key)" />
                </span>
                <template v-if="editingId === draft.id">
                  <label>
                    <span>Dato</span>
                    <input
                      v-model="draft.key"
                      :disabled="!canUseCrud"
                      :maxlength="CUSTOM_DATA_KEY_MAX_LENGTH"
                      aria-label="Dato personalizado"
                    />
                  </label>
                  <label>
                    <span>Tipo de información</span>
                    <select v-model="draft.dataType" :disabled="!canUseCrud" aria-label="Formato del dato">
                      <option v-for="type in CUSTOM_DATA_TYPES" :key="type.value" :value="type.value">
                        {{ type.label }}
                      </option>
                    </select>
                  </label>
                  <label>
                    <span>Valor</span>
                    <div class="value-input-shell" :class="{ 'value-input-shell--date': draft.dataType === 'date' }">
                      <input
                        v-model="draft.value"
                        :type="getDataType(draft.dataType).inputType"
                        :disabled="!canUseCrud"
                        :maxlength="IDENTIFICATION_MAX_LENGTH"
                        :placeholder="getDataType(draft.dataType).placeholder"
                        aria-label="Valor personalizado"
                        @pointerdown.capture="openDatePicker($event, draft.dataType)"
                      />
                      <button
                        v-if="draft.dataType === 'date'"
                        class="date-picker-trigger"
                        type="button"
                        tabindex="-1"
                        aria-label="Abrir selector de fecha"
                        @click="openDatePickerFromTrigger"
                      />
                      <CalendarDays v-if="draft.dataType === 'date'" class="date-picker-icon" :size="19" aria-hidden="true" />
                    </div>
                  </label>
                  <label class="protection-toggle">
                    <input v-model="draft.protected" type="checkbox" />
                    <span><LockKeyhole :size="16" /> Proteger valor</span>
                  </label>
                </template>
                <template v-else>
                  <span class="row-key">
                    <span>{{ draft.key }}</span>
                    <small>{{ getDataType(draft.dataType).label }}<template v-if="draft.protected"> · Protegido</template></small>
                  </span>
                  <strong class="row-value" :class="{ 'row-value--masked': draft.masked }">
                    {{ draft.masked ? '••••••••' : formatCustomDataValue(draft.value, draft.dataType) }}
                  </strong>
                </template>
                <div class="row-actions">
                  <v-btn
                    v-if="editingId !== draft.id"
                    class="edit-button"
                    :class="{ 'locked-action-button': !auth.authorized }"
                    icon
                    :disabled="isLoading || isSaving || (!auth.authorized && !auth.canRequestCode)"
                    type="button"
                    variant="flat"
                    :aria-label="auth.authorized ? 'Editar' : 'Obtener código para editar'"
                    :title="auth.authorized ? 'Editar' : 'Obtén un código para editar'"
                    @click="runProtectedAction(() => startEdit(draft))"
                  >
                    <AppIcon name="edit" />
                    <LockKeyhole v-if="!auth.authorized" class="action-lock-icon" :size="16" aria-hidden="true" />
                  </v-btn>
                  <v-btn
                    v-if="editingId === draft.id"
                    class="save-icon-button"
                    icon
                    :disabled="!canUseCrud || !draft.key.trim() || !draft.value.trim()"
                    :loading="savingKey === `saved-${draft.id}`"
                    type="submit"
                    variant="flat"
                    aria-label="Guardar cambios"
                  >
                    <AppIcon name="save" />
                  </v-btn>
                  <v-btn
                    v-if="editingId === draft.id"
                    class="cancel-button"
                    icon
                    :disabled="!canUseCrud"
                    type="button"
                    variant="flat"
                    aria-label="Cancelar edición"
                    @click="cancelEdit(draft)"
                  >
                    <AppIcon name="close" />
                  </v-btn>
                  <v-btn
                    v-if="editingId !== draft.id"
                    class="delete-button"
                    :class="{ 'locked-action-button': !auth.authorized }"
                    icon
                    :disabled="isLoading || isSaving || (!auth.authorized && !auth.canRequestCode)"
                    :loading="savingKey === `delete-${draft.id}`"
                    type="button"
                    variant="flat"
                    :aria-label="auth.authorized ? 'Eliminar' : 'Obtener código para eliminar'"
                    :title="auth.authorized ? 'Eliminar' : 'Obtén un código para eliminar'"
                    @click="runProtectedAction(() => removeCustomData(draft))"
                  >
                    <AppIcon name="trash" />
                    <LockKeyhole v-if="!auth.authorized" class="action-lock-icon" :size="16" aria-hidden="true" />
                  </v-btn>
                </div>
              </form>
            </div>

            <div v-if="!isLoading && !isAtCustomDataLimit" class="new-data-intro">
              <strong>Agregar otro dato</strong>
              <span>{{ categoryCopy.newData }}</span>
            </div>

            <form
              v-if="!isLoading && !isAtCustomDataLimit"
              class="inline-row new-data-row"
              @submit.prevent="saveNewDraft(newDraft, 'new')"
            >
              <span class="row-icon" aria-hidden="true">
                <AppIcon name="file" />
              </span>
              <label>
                <span>Nuevo dato</span>
                <input
                  v-model="newDraft.key"
                  :disabled="!canUseCrud"
                  :maxlength="CUSTOM_DATA_KEY_MAX_LENGTH"
                  placeholder="Ej. Raza"
                  aria-label="Nuevo dato personalizado"
                />
              </label>
              <label>
                <span>Tipo de información</span>
                <select v-model="newDraft.dataType" :disabled="!canUseCrud" aria-label="Formato del nuevo dato">
                  <option v-for="type in CUSTOM_DATA_TYPES" :key="type.value" :value="type.value">
                    {{ type.label }}
                  </option>
                </select>
              </label>
              <label>
                <span>Valor</span>
                <div class="value-input-shell" :class="{ 'value-input-shell--date': newDraft.dataType === 'date' }">
                  <input
                    v-model="newDraft.value"
                    :type="getDataType(newDraft.dataType).inputType"
                    :disabled="!canUseCrud"
                    :maxlength="IDENTIFICATION_MAX_LENGTH"
                    :placeholder="getDataType(newDraft.dataType).placeholder"
                    aria-label="Valor del nuevo dato"
                    @pointerdown.capture="openDatePicker($event, newDraft.dataType)"
                  />
                  <button
                    v-if="newDraft.dataType === 'date'"
                    class="date-picker-trigger"
                    type="button"
                    tabindex="-1"
                    aria-label="Abrir selector de fecha"
                    @click="openDatePickerFromTrigger"
                  />
                  <CalendarDays v-if="newDraft.dataType === 'date'" class="date-picker-icon" :size="19" aria-hidden="true" />
                </div>
              </label>
              <label class="protection-toggle">
                <input v-model="newDraft.protected" type="checkbox" />
                <span><LockKeyhole :size="16" /> Proteger valor</span>
              </label>
              <v-btn
                class="save-button"
                :class="{ 'save-button--locked': !auth.authorized }"
                color="primary"
                :disabled="auth.authorized
                  ? !canUseCrud || !newDraft.key.trim() || !newDraft.value.trim()
                  : isLoading || isSaving || !auth.canRequestCode"
                :loading="savingKey === 'new'"
                :type="auth.authorized ? 'submit' : 'button'"
                variant="flat"
                @click="!auth.authorized && requestProtectedAccess()"
              >
                <template v-if="auth.authorized">
                  <span class="plus-icon" aria-hidden="true" />
                  Agregar
                </template>
                <template v-else>
                  <LockKeyhole :size="19" />
                  Obtener código
                </template>
              </v-btn>
            </form>
          </v-sheet>
        </section>
      </v-main>
    </div>

    <v-dialog v-model="accessDialog" max-width="430" persistent>
      <v-card class="access-dialog">
        <div class="access-dialog__icon"><Mail :size="26" /></div>
        <h2>Escribe el código</h2>
        <p>Enviamos un código de seis dígitos a <strong>{{ auth.emailHint }}</strong>. Vence en 10 minutos.</p>
        <form @submit.prevent="verifyAccess">
          <input
            v-model="accessCode"
            inputmode="numeric"
            maxlength="6"
            pattern="[0-9]{6}"
            autocomplete="one-time-code"
            aria-label="Código de acceso"
            placeholder="000000"
            @input="accessCode = accessCode.replace(/\D/g, '').slice(0, 6)"
          />
          <div>
            <v-btn variant="text" type="button" @click="accessDialog = false">Cancelar</v-btn>
            <v-btn color="primary" type="submit" variant="flat" :disabled="accessCode.length !== 6" :loading="savingKey === 'verify-access'">Verificar</v-btn>
          </div>
        </form>
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
          <AppIcon name="close" />
        </v-btn>
      </template>
    </v-snackbar>
  </v-app>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  background:
    radial-gradient(circle at 5% 82%, rgba(213, 235, 252, 0.96), transparent 27%),
    radial-gradient(circle at 94% 72%, rgba(217, 238, 255, 0.9), transparent 24%),
    linear-gradient(180deg, #ffffff 0%, #f7fbff 45%, #ffffff 100%);
  color: #05083e;
}

:deep(.v-snackbar .v-btn svg) {
  width: 20px;
  height: 20px;
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  background: rgba(255, 255, 255, 0.92);
  border-bottom: 1px solid #e3edf9;
  box-shadow: 0 8px 26px rgba(62, 122, 190, 0.12);
  backdrop-filter: blur(16px);
}

.topbar-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: min(100%, 1120px);
  min-height: 78px;
  margin: 0 auto;
  padding: 0 24px;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 14px;
  color: #05083e;
  text-decoration: none;
}

.brand-mark {
  position: relative;
  display: inline-block;
  flex: 0 0 auto;
  transform: rotate(-45deg);
}

.brand-mark--small {
  width: 46px;
  height: 46px;
}

.brand-arm {
  position: absolute;
  display: block;
  border-radius: 999px;
}

.brand-arm--top {
  inset: 4px 4px auto 0;
  height: 15px;
  background: linear-gradient(135deg, #0d4ff6 0%, #1198ff 72%);
}

.brand-arm--top::before {
  position: absolute;
  top: 0;
  left: 0;
  width: 15px;
  height: 42px;
  content: "";
  border-radius: 999px;
  background: linear-gradient(180deg, #16a9ff 0%, #0c50f5 100%);
}

.brand-arm--bottom {
  right: 0;
  bottom: 4px;
  width: 38px;
  height: 15px;
  background: linear-gradient(135deg, #12a7ff 0%, #20efe0 100%);
}

.brand-arm--bottom::after {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 15px;
  height: 32px;
  content: "";
  border-radius: 999px;
  background: linear-gradient(180deg, #16e2e5 0%, #0b79ff 100%);
}

.brand-word {
  display: flex;
  align-items: baseline;
  font-size: 1.5rem;
  line-height: 1;
}

.brand-word strong {
  font-weight: 850;
}

.brand-word span {
  font-weight: 400;
}

.qr-button {
  width: 46px;
  height: 46px;
  color: #0873ff;
  background: #eef7ff;
  border-radius: 12px;
}

.qr-glyph {
  display: block;
  width: 30px;
  height: 30px;
  color: #0873ff;
}

.qr-glyph path {
  fill: none;
  stroke: currentColor;
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.main-area {
  padding: 34px 16px 56px;
}

.content {
  width: 70vw;
  margin: 0 auto;
}

.headline {
  margin: 0 0 18px 24px;
}

.headline h1 {
  margin: 0;
  color: #05083e;
  font-size: clamp(2.3rem, 5vw, 3.25rem);
  font-weight: 900;
  line-height: 1;
}

.headline p {
  margin: 8px 0 0;
  color: #5a6ea8;
  font-size: clamp(1.1rem, 2vw, 1.45rem);
  line-height: 1.25;
}

.id-card,
.data-card {
  background: rgba(255, 255, 255, 0.88);
  border-color: #d9e9fb;
  box-shadow: 0 14px 40px rgba(66, 126, 197, 0.12);
}

.id-card {
  padding: 18px 28px 20px;
}

.id-card h2,
.data-card h2 {
  margin: 0;
  color: #11154b;
  font-size: 1.36rem;
  font-weight: 850;
  line-height: 1.1;
}

.identifier-pill {
  display: flex;
  align-items: center;
  gap: 24px;
  min-height: 76px;
  margin-top: 12px;
  padding: 12px 28px;
  overflow: hidden;
  border-radius: 18px;
  background:
    linear-gradient(90deg, rgba(218, 240, 255, 0.94), rgba(209, 235, 253, 0.95)),
    radial-gradient(circle at 84% 45%, rgba(189, 223, 247, 0.85), transparent 36%);
}

.tag-icon {
  width: 56px;
  height: 56px;
  color: #0873ff;
}

.tag-icon svg,
.square-icon svg,
.row-icon svg,
.edit-button svg,
.save-icon-button svg,
.cancel-button svg,
.delete-button svg {
  display: block;
  width: 100%;
  height: 100%;
}

.tag-icon path {
  fill: currentColor;
}

.identifier-pill strong {
  color: #05083e;
  font-size: clamp(2.2rem, 7vw, 3.1rem);
  font-weight: 900;
  line-height: 1;
}

.id-card > p {
  margin: 12px 0 0;
  color: #5570ad;
  font-size: 1.04rem;
  line-height: 1.35;
}

.data-card {
  margin-top: 20px;
  padding: 20px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-bottom: 16px;
}

.section-title p {
  margin: 3px 0 0;
  color: #5a6ea8;
  font-size: 1.08rem;
  line-height: 1.25;
}

.access-panel {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  margin: 0 0 16px;
  padding: 13px 14px;
  color: #74520d;
  background: #fff9e9;
  border: 1px solid #f1d999;
  border-radius: 10px;
}

.access-panel--verified {
  color: #126047;
  background: #eaf8f2;
  border-color: #bfe5d5;
}

.access-panel > div { display: grid; gap: 2px; }
.access-panel span { font-size: .84rem; line-height: 1.35; }
.access-button { text-transform: none; letter-spacing: 0; }
.access-button :deep(.v-btn__content) { gap: 7px; }

.square-icon {
  display: grid;
  width: 54px;
  height: 54px;
  flex: 0 0 auto;
  place-items: center;
  color: #ffffff;
  border-radius: 10px;
  background: linear-gradient(135deg, #0f8fff, #0759f6);
  box-shadow: 0 10px 20px rgba(5, 101, 246, 0.22);
}

.square-icon svg {
  width: 34px;
  height: 34px;
}

.inline-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin: 0 2px 12px;
  color: #5570ad;
  font-size: 0.88rem;
}

.inline-row {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1fr) auto;
  gap: 10px;
  align-items: end;
}

.inline-row label {
  display: grid;
  gap: 5px;
  min-width: 0;
  color: #304d89;
  font-size: 0.82rem;
  font-weight: 750;
}

.inline-row input,
.inline-row select {
  width: 100%;
  min-height: 44px;
  padding: 0 12px;
  color: #071045;
  font: inherit;
  font-weight: 500;
  background: #ffffff;
  border: 1px solid #c9dcf2;
  border-radius: 9px;
  outline: none;
  box-shadow: inset 0 1px 2px rgba(11, 56, 111, 0.04);
}

.inline-row select {
  cursor: pointer;
}

.inline-row input[type='date'] {
  position: relative;
  padding-right: 42px;
  cursor: pointer;
  touch-action: manipulation;
}

.value-input-shell {
  position: relative;
  min-width: 0;
}

.date-picker-icon {
  position: absolute;
  top: 50%;
  right: 12px;
  z-index: 1;
  color: #285db8;
  pointer-events: none;
  transform: translateY(-50%);
}

.date-picker-trigger {
  position: absolute;
  inset: 0;
  z-index: 3;
  width: 100%;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 9px;
}

.inline-row input[type='date']::-webkit-calendar-picker-indicator {
  position: absolute;
  inset: 0;
  z-index: 2;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  cursor: pointer;
  opacity: 0;
}

.inline-row label > span {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.inline-row label small,
.row-key small {
  width: fit-content;
  padding: 2px 6px;
  color: #476896;
  font-size: 0.7rem;
  font-weight: 750;
  background: #eaf4ff;
  border-radius: 999px;
}

.inline-row input::placeholder {
  color: #8090bb;
}

.inline-row input:focus,
.inline-row select:focus {
  border-color: #0b7eff;
  box-shadow: 0 0 0 4px rgba(11, 126, 255, 0.12);
}

.inline-row input:disabled,
.inline-row select:disabled {
  color: #67779e;
  background: #f5f8fc;
}

.save-button {
  min-width: 118px;
  min-height: 44px;
  padding: 0 16px;
  border-radius: 10px;
  font-size: 0.92rem;
  font-weight: 700;
  text-transform: none;
  box-shadow: 0 10px 22px rgba(2, 101, 243, 0.24);
}

.save-button svg {
  width: 20px;
  height: 20px;
  margin-right: 7px;
}

.plus-icon {
  position: relative;
  width: 24px;
  height: 24px;
  margin-right: 8px;
}

.plus-icon::before,
.plus-icon::after {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 22px;
  height: 2px;
  content: "";
  background: currentColor;
  border-radius: 99px;
  transform: translate(-50%, -50%);
}

.plus-icon::after {
  transform: translate(-50%, -50%) rotate(90deg);
}

.suggestions-panel {
  margin: 0 0 14px;
  padding: 14px 16px;
  border: 1px dashed #bed8f4;
  border-radius: 14px;
  background: rgba(244, 250, 255, 0.82);
}

.suggestions-panel h3 {
  margin: 0;
  color: #304d89;
  font-size: 0.98rem;
  font-weight: 800;
}

.suggestions-heading {
  margin-bottom: 12px;
}

.suggestions-heading p {
  margin: 3px 0 0;
  color: #687da9;
  font-size: 0.82rem;
}

.suggestion-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.suggestion-option {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 7px 13px;
  color: #0867e8;
  font: inherit;
  font-size: 0.86rem;
  font-weight: 750;
  line-height: 1.2;
  text-align: left;
  cursor: pointer;
  background: #ffffff;
  border: 1px solid #c9def6;
  border-radius: 999px;
  transition: background-color 160ms ease, border-color 160ms ease, color 160ms ease;
}

.suggestion-option:hover:not(:disabled),
.suggestion-option--selected {
  color: #ffffff;
  background: #0873ff;
  border-color: #0873ff;
}

.suggestion-option:focus-visible {
  outline: 3px solid rgba(8, 115, 255, 0.22);
  outline-offset: 2px;
}

.suggestion-option:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.suggestion-option--locked:not(:disabled) {
  color: #345f98;
  background: #f4f8fc;
  border-color: #cbdced;
}

.suggestion-option--locked:hover:not(:disabled) {
  color: #174a8b;
  background: #e8f2fc;
  border-color: #a9c9e9;
}

.inline-row--suggestion {
  grid-template-columns: minmax(0, .9fr) minmax(0, 1fr) auto auto;
  margin-top: 12px;
  padding: 10px;
  border: 1px solid #d7e7f8;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 5px 14px rgba(66, 126, 197, 0.06);
}

.suggestion-actions {
  display: flex;
  align-items: center;
  gap: 7px;
}

.status-message {
  margin: 0 0 14px;
  padding: 12px 14px;
  color: #304d89;
  font-weight: 650;
  border: 1px solid #d8e8fa;
  border-radius: 12px;
  background: #f2f8ff;
}

.status-message--error {
  color: #9d171e;
  border-color: #ffd8dc;
  background: #fff3f4;
}

.data-list {
  overflow: hidden;
  margin-bottom: 14px;
  border: 1px solid #e0ebf8;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.72);
}

.data-row {
  grid-template-columns: 38px minmax(0, 0.9fr) minmax(0, 1fr) auto;
  min-height: 72px;
  padding: 9px 12px;
  border-bottom: 1px solid #e0ebf8;
}

.data-row:has(label) {
  grid-template-columns: 38px minmax(0, 0.8fr) minmax(130px, 0.75fr) minmax(0, 1fr) auto auto;
}

.data-row:last-child {
  border-bottom: 0;
}

.row-icon {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  color: #285db8;
}

.row-actions {
  display: flex;
  gap: 8px;
}

.row-key {
  display: grid;
  gap: 4px;
  color: #5870ad;
  font-size: 0.96rem;
}

.row-value {
  overflow-wrap: anywhere;
  color: #05083e;
  font-size: 1rem;
  font-weight: 650;
}

.row-value--masked { letter-spacing: 3px; color: #526684; }

.protection-toggle {
  display: flex !important;
  align-items: center;
  align-self: center;
  gap: 7px !important;
  min-height: 44px;
  padding: 0 10px;
  color: #28558f !important;
  background: #eef6ff;
  border: 1px solid #d0e3f8;
  border-radius: 9px;
  white-space: nowrap;
}

.protection-toggle input { width: 17px; min-height: 17px; padding: 0; box-shadow: none; }
.protection-toggle span { display: inline-flex; align-items: center; gap: 5px; }

.edit-button,
.save-icon-button,
.cancel-button,
.delete-button {
  position: relative;
  width: 42px;
  height: 42px;
  border: 1px solid;
  border-radius: 10px;
}

.edit-button,
.save-icon-button {
  color: #285db8;
  background: #edf6ff;
  border-color: #cfe3f8;
}

.cancel-button {
  color: #65758c;
  background: #f4f6f9;
  border-color: #dce4ed;
}

.delete-button {
  color: #ff1018;
  background: #fff0f0;
  border-color: #ffdede;
}

.edit-button.locked-action-button,
.delete-button.locked-action-button {
  width: 54px;
  color: #315f98;
  background: #eef5fc;
  border-color: #c8dcef;
}

.locked-action-button :deep(.v-btn__content) {
  gap: 3px;
}

.locked-action-button .action-lock-icon {
  width: 16px;
  height: 16px;
  color: #174a8b;
  stroke-width: 2.5;
}

.edit-button svg,
.save-icon-button svg,
.cancel-button svg,
.delete-button svg {
  width: 22px;
  height: 22px;
}

.new-data-row {
  grid-template-columns: 38px minmax(0, 0.8fr) minmax(130px, 0.75fr) minmax(0, 1fr) auto auto;
  padding: 12px;
  border: 1px solid #d7e7f8;
  border-radius: 14px;
  background: linear-gradient(180deg, rgba(235, 247, 255, 0.98), rgba(244, 250, 255, 0.94));
}

.access-dialog { padding: 24px; text-align: center; }
.access-dialog__icon { display: grid; width: 54px; height: 54px; margin: 0 auto 12px; place-items: center; color: #0873ff; background: #eaf4ff; border-radius: 50%; }
.access-dialog h2 { margin: 0; color: #071045; font-size: 1.35rem; }
.access-dialog p { margin: 8px 0 18px; color: #607194; line-height: 1.45; }
.access-dialog form { display: grid; gap: 18px; }
.access-dialog form > input { width: 100%; min-height: 54px; color: #071045; font-size: 1.5rem; font-weight: 800; letter-spacing: 8px; text-align: center; border: 1px solid #bfd7f2; border-radius: 9px; outline: none; }
.access-dialog form > div { display: flex; justify-content: flex-end; gap: 8px; }

.new-data-intro {
  display: grid;
  gap: 2px;
  margin: 4px 2px 9px;
  color: #304d89;
}

.new-data-intro strong {
  color: #11154b;
  font-size: 0.98rem;
}

.new-data-intro span {
  font-size: 0.86rem;
  line-height: 1.35;
}

@media (max-width: 1024px) {
  .content {
    width: 100%;
  }
}

@media (max-width: 760px) {
  .topbar {
    position: relative;
  }

  .topbar-inner {
    min-height: 88px;
    padding: 0 24px;
  }

  .main-area {
    padding: 28px 16px 42px;
  }

  .content {
    width: min(100%, 680px);
  }

  .headline {
    margin-left: 10px;
  }

  .id-card {
    padding: 20px 24px;
  }

  .data-card {
    padding: 18px;
  }

  .identifier-pill {
    min-height: 70px;
    padding: 10px 22px;
  }

  .data-row {
    grid-template-columns: 34px minmax(0, 0.9fr) minmax(0, 1fr) auto;
    min-height: 72px;
    padding: 8px 10px;
  }

  .suggestions-panel {
    margin-right: -4px;
    margin-left: -4px;
    padding: 12px;
  }

  .edit-button,
  .save-icon-button,
  .cancel-button,
  .delete-button {
    width: 42px;
    height: 42px;
  }
}

@media (max-width: 560px) {
  .brand-word {
    font-size: 1.22rem;
  }

  .brand-mark--small {
    width: 40px;
    height: 40px;
  }

  .inline-header {
    display: grid;
    gap: 3px;
  }

  .access-panel { grid-template-columns: auto minmax(0, 1fr); }
  .access-panel .access-button { grid-column: 1 / -1; width: 100%; }

  .inline-row,
  .data-row,
  .new-data-row {
    grid-template-columns: 34px minmax(0, 1fr) auto;
    align-items: end;
  }

  .data-row:has(label) {
    grid-template-columns: 34px minmax(0, 1fr) auto;
  }

  .inline-row--suggestion {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 9px;
    padding: 11px;
  }

  .inline-row--suggestion .protection-toggle { grid-column: 1 / -1; }

  .inline-row--suggestion label:first-child {
    grid-column: 1 / -1;
  }

  .inline-row--suggestion .save-button {
    width: 44px;
    min-width: 44px;
    padding: 0;
    font-size: 0;
  }

  .inline-row--suggestion .save-button svg {
    width: 21px;
    height: 21px;
    margin: 0;
  }

  .inline-row--suggestion .suggestion-actions {
    grid-column: 2;
  }

  .data-row label:first-of-type,
  .new-data-row label:first-of-type {
    grid-column: 2 / -1;
  }

  .data-row label:nth-of-type(2),
  .new-data-row label:nth-of-type(2) {
    grid-column: 2;
  }

  .data-row label:nth-of-type(3),
  .new-data-row label:nth-of-type(3) {
    grid-column: 2;
  }

  .data-row .protection-toggle,
  .new-data-row .protection-toggle {
    grid-column: 2;
  }

  .data-row .row-icon,
  .new-data-row .row-icon {
    grid-row: 1 / span 4;
    align-self: center;
  }

  .data-row .row-actions {
    grid-row: 4;
    grid-column: 3;
  }

  .data-row .row-key {
    grid-column: 2;
    align-self: end;
  }

  .data-row .row-value {
    grid-row: 2;
    grid-column: 2;
    align-self: start;
  }

  .data-row:has(.row-key) .row-actions {
    grid-row: 1 / span 2;
    align-self: center;
  }

  .new-data-row .save-button {
    grid-row: 5;
    grid-column: 2 / -1;
    width: 100%;
  }

  .new-data-row .save-button--locked {
    gap: 7px;
  }

  .new-data-row .plus-icon {
    margin: 0;
  }

  .save-button {
    width: 100%;
  }
}
</style>
