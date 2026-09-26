<script setup>
import { computed, h, onMounted, ref } from 'vue'
import {
  CUSTOM_DATA_LIMIT,
  createCustomData,
  deleteCustomData,
  fetchEntity,
  getRouteContext,
  updateCustomData,
} from './services/entityApi'
import {
  CUSTOM_DATA_KEY_MAX_LENGTH,
  IDENTIFICATION_MAX_LENGTH,
} from './services/validation'

const routeContext = getRouteContext()
const category = ref(null)
const entity = ref(null)
const customData = ref([])
const fieldKey = ref('')
const fieldValue = ref('')
const editingId = ref(null)
const isLoading = ref(false)
const isSaving = ref(false)
const errorMessage = ref('')

const canUseCrud = computed(() => routeContext.isValid && !isLoading.value && !isSaving.value)
const isAtCustomDataLimit = computed(
  () => !editingId.value && customData.value.length >= CUSTOM_DATA_LIMIT,
)
const canSubmit = computed(() => canUseCrud.value && !isAtCustomDataLimit.value)
const identifierText = computed(() => entity.value?.identificacion || 'Sin datos')
const helperText = computed(() => {
  if (isAtCustomDataLimit.value) return `Límite alcanzado: ${CUSTOM_DATA_LIMIT} datos personalizados.`

  const countText = `${customData.value.length}/${CUSTOM_DATA_LIMIT} datos guardados.`
  const guidance =
    entity.value || customData.value.length > 0
      ? 'Ambos campos son obligatorios.'
      : 'Guarda la información adicional que necesites.'

  return `${guidance} ${countText}`
})
const submitLabel = computed(() => (editingId.value ? 'Guardar' : 'Agregar'))

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
  edit: [
    'M14 47.5 17.5 36 43 10.5a5.7 5.7 0 0 1 8 8L25.5 44 14 47.5Z',
    'M37 16.5 44.5 24',
  ],
  trash: [
    'M20 22h32M27 22v30h18V22M29 22l2-8h10l2 8',
    'M32 30v14M40 30v14',
  ],
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
    errorMessage.value = 'Abre una URL con el formato /codigo-categoria/token.'
    return
  }

  await runRequest(async () => {
    applyContext(await fetchEntity(routeContext.categoryCode, routeContext.token))
  }, true)
}

async function submitCustomData() {
  if (!fieldKey.value.trim() || !fieldValue.value.trim() || !canSubmit.value) return

  await runRequest(async () => {
    const payload = {
      key: fieldKey.value,
      value: fieldValue.value,
    }

    const context = editingId.value
      ? await updateCustomData(routeContext.categoryCode, routeContext.token, editingId.value, payload)
      : await createCustomData(routeContext.categoryCode, routeContext.token, payload)

    applyContext(context)
    resetForm()
  })
}

function startEdit(item) {
  editingId.value = item.id
  fieldKey.value = item.key
  fieldValue.value = item.value
}

async function removeCustomData(item) {
  if (!canUseCrud.value) return

  await runRequest(async () => {
    applyContext(await deleteCustomData(routeContext.categoryCode, routeContext.token, item.id))
    if (editingId.value === item.id) resetForm()
  })
}

function resetForm() {
  editingId.value = null
  fieldKey.value = ''
  fieldValue.value = ''
}

function applyContext(context) {
  category.value = context.category
  entity.value = context.entity
  customData.value = context.entity?.customData || []
}

async function runRequest(callback, initialLoad = false) {
  errorMessage.value = ''
  isLoading.value = initialLoad
  isSaving.value = !initialLoad

  try {
    await callback()
  } catch (error) {
    errorMessage.value = error.message || 'Ocurrió un error inesperado.'
  } finally {
    isLoading.value = false
    isSaving.value = false
  }
}

function getIconForKey(key) {
  const normalizedKey = key.toLowerCase()

  if (normalizedKey.includes('placa') || normalizedKey.includes('carro')) return 'car'
  if (normalizedKey.includes('tipo') || normalizedKey.includes('raza')) return 'paw'
  if (normalizedKey.includes('color')) return 'palette'
  if (normalizedKey.includes('propietario') || normalizedKey.includes('persona')) return 'user'

  return 'file'
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
            <h1>Identificación</h1>
            <p>Guarda datos personalizados desde un código QR</p>
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
                <h2>Datos personalizados</h2>
                <p>Agrega y administra la información que necesites</p>
              </div>
            </div>

            <div v-if="errorMessage" class="status-message status-message--error">
              {{ errorMessage }}
            </div>

            <div v-if="isLoading" class="status-message">Cargando información...</div>

            <form v-else class="input-panel" @submit.prevent="submitCustomData">
              <label>
                <span>Dato <b>*</b></span>
                <input
                  v-model="fieldKey"
                  :disabled="!canSubmit"
                  :maxlength="CUSTOM_DATA_KEY_MAX_LENGTH"
                  placeholder="Ej. Raza"
                />
              </label>
              <label>
                <span>Valor <b>*</b></span>
                <input
                  v-model="fieldValue"
                  :disabled="!canSubmit"
                  :maxlength="IDENTIFICATION_MAX_LENGTH"
                  placeholder="Ej. Labrador"
                />
              </label>
              <v-btn
                class="add-button"
                color="primary"
                :disabled="!canSubmit"
                :loading="isSaving"
                size="large"
                type="submit"
                variant="flat"
              >
                <span class="plus-icon" aria-hidden="true" />
                {{ submitLabel }}
              </v-btn>
              <p>{{ helperText }}</p>
            </form>

            <div class="data-list" aria-label="Datos personalizados guardados">
              <div v-if="!customData.length && !isLoading" class="empty-row">
                Aún no hay datos personalizados.
              </div>
              <div v-for="item in customData" :key="item.id" class="data-row">
                <span class="row-icon" aria-hidden="true">
                  <AppIcon :name="getIconForKey(item.key)" />
                </span>
                <span class="row-key">{{ item.key }}</span>
                <strong class="row-value">{{ item.value }}</strong>
                <div class="row-actions">
                  <v-btn
                    class="edit-button"
                    icon
                    :disabled="!canUseCrud"
                    variant="flat"
                    aria-label="Editar"
                    @click="startEdit(item)"
                  >
                    <AppIcon name="edit" />
                  </v-btn>
                  <v-btn
                    class="delete-button"
                    icon
                    :disabled="!canUseCrud"
                    variant="flat"
                    aria-label="Eliminar"
                    @click="removeCustomData(item)"
                  >
                    <AppIcon name="trash" />
                  </v-btn>
                </div>
              </div>
            </div>
          </v-sheet>
        </section>
      </v-main>
    </div>
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
  width: min(100%, 980px);
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
  width: min(100%, 720px);
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

.input-panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  gap: 10px 10px;
  align-items: end;
  margin: 0 -4px 14px;
  padding: 14px 16px;
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(235, 247, 255, 0.98), rgba(244, 250, 255, 0.94));
}

.input-panel label {
  display: grid;
  gap: 6px;
  color: #304d89;
  font-size: 0.98rem;
  font-weight: 700;
}

.input-panel b {
  color: #ff171e;
}

.input-panel input {
  width: 100%;
  min-height: 48px;
  padding: 0 14px;
  color: #071045;
  font: inherit;
  font-weight: 500;
  background: #ffffff;
  border: 1px solid #c9dcf2;
  border-radius: 9px;
  outline: none;
  box-shadow: inset 0 1px 2px rgba(11, 56, 111, 0.04);
}

.input-panel input::placeholder {
  color: #8090bb;
}

.input-panel input:focus {
  border-color: #0b7eff;
  box-shadow: 0 0 0 4px rgba(11, 126, 255, 0.12);
}

.add-button {
  min-width: 128px;
  min-height: 48px;
  padding: 0 16px;
  border-radius: 10px;
  font-size: 1rem;
  font-weight: 700;
  text-transform: none;
  box-shadow: 0 10px 22px rgba(2, 101, 243, 0.24);
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

.input-panel > p {
  grid-column: 1 / -1;
  margin: 0;
  color: #5570ad;
  font-size: 0.9rem;
  line-height: 1.2;
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
  border: 1px solid #e0ebf8;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.72);
}

.empty-row {
  padding: 18px;
  color: #5870ad;
  font-weight: 600;
  text-align: center;
}

.data-row {
  display: grid;
  grid-template-columns: 50px minmax(92px, 0.7fr) minmax(112px, 1fr) auto;
  gap: 12px;
  align-items: center;
  min-height: 52px;
  padding: 7px 12px;
  border-bottom: 1px solid #e0ebf8;
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

.row-key {
  color: #5870ad;
  font-size: 1rem;
}

.row-value {
  color: #05083e;
  font-size: 1rem;
  font-weight: 600;
}

.row-actions {
  display: flex;
  gap: 10px;
}

.edit-button,
.delete-button {
  width: 38px;
  height: 38px;
  border: 1px solid;
  border-radius: 10px;
}

.edit-button {
  color: #285db8;
  background: #ffffff;
  border-color: #d7e6f8;
}

.delete-button {
  color: #ff1018;
  background: #fff0f0;
  border-color: #ffdede;
}

.edit-button svg,
.delete-button svg {
  width: 24px;
  height: 24px;
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

  .input-panel {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
    margin-right: -8px;
    margin-left: -8px;
    gap: 8px;
    padding: 12px;
  }

  .data-row {
    grid-template-columns: 42px minmax(84px, 0.8fr) minmax(110px, 1fr) auto;
    gap: 10px;
    min-height: 66px;
    padding: 8px 10px;
  }

  .row-actions {
    gap: 8px;
  }

  .edit-button,
  .delete-button {
    width: 48px;
    height: 48px;
  }
}

@media (max-width: 390px) {
  .brand-word {
    font-size: 1.22rem;
  }

  .brand-mark--small {
    width: 40px;
    height: 40px;
  }

  .input-panel {
    grid-template-columns: 1fr;
  }

  .add-button {
    width: 100%;
  }

  .data-row {
    grid-template-columns: 34px 1fr auto;
  }

  .row-value {
    grid-column: 2 / 3;
  }

  .row-actions {
    grid-row: 1 / span 2;
    grid-column: 3;
  }
}
</style>
