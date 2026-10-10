<script setup>
/* eslint-disable vue/no-mutating-props -- settings is the shared reactive draft owned by AdminApp. */
import { Download, Printer, X } from '@lucide/vue'

const props = defineProps({
  modelValue: Boolean,
  entity: { type: Object, default: null },
  entityUrl: { type: String, default: '' },
  metrics: { type: Object, default: null },
  settings: { type: Object, required: true },
  isSaving: Boolean,
})

const emit = defineEmits(['update:modelValue', 'download-svg', 'download-stl'])

function updateQrSize(event) {
  const size = Number(event.currentTarget.value)
  if (Number.isFinite(size) && size >= 10 && size <= 200) props.settings.qrSizeMm = size
}

function restoreQrSize(event) {
  event.currentTarget.value = String(props.settings.qrSizeMm)
}
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="760" @update:model-value="emit('update:modelValue', $event)">
    <v-card class="admin-dialog print-dialog">
      <div class="dialog-header">
        <div><Printer :size="21" /><h2>Preparar impresión 3D</h2></div>
        <button type="button" aria-label="Cerrar" @click="emit('update:modelValue', false)"><X :size="21" /></button>
      </div>
      <div v-if="entity && metrics" class="print-content">
        <div class="print-summary">
          <div><span>Entidad</span><strong>{{ entity.displayName }}</strong></div>
          <div><span>Impresora</span><strong>FlashForge AD5X</strong></div>
          <div><span>URL corta</span><code>{{ entityUrl }}</code></div>
        </div>
        <div class="print-controls">
          <label class="field"><span>Formato</span><select v-model="settings.format"><option value="plate">Placa</option><option value="keychain">Llavero con orificio</option></select></label>
          <label class="field"><span>Tamaño del QR</span><input :value="settings.qrSizeMm" type="number" inputmode="decimal" min="10" max="200" step="1" list="qr-print-sizes" aria-label="Tamaño del QR en milímetros" @input="updateQrSize" @blur="restoreQrSize" /><datalist id="qr-print-sizes"><option value="26" /><option value="50" /><option value="60" /><option value="80" /></datalist></label>
          <label class="field"><span>Boquilla</span><select v-model.number="settings.nozzleMm"><option :value="0.25">0.25 mm · opcional</option><option :value="0.4">0.4 mm · instalada de fábrica</option><option :value="0.6">0.6 mm · opcional</option><option :value="0.8">0.8 mm · opcional</option></select></label>
          <label class="field"><span>Grosor de la base</span><select v-model.number="settings.baseHeightMm"><option :value="1.6">1.6 mm</option><option :value="2">2.0 mm</option><option :value="2.4">2.4 mm</option></select></label>
          <label class="field"><span>Altura del relieve</span><select v-model.number="settings.reliefHeightMm"><option :value="0.6">0.6 mm</option><option :value="0.8">0.8 mm</option><option :value="1.2">1.2 mm</option></select></label>
        </div>
        <div class="print-metrics" :class="{ 'print-metrics--warning': !metrics.isPrintable }">
          <Printer :size="22" />
          <div><strong>{{ metrics.isPrintable ? 'Configuración lista para imprimir' : 'Módulos demasiado pequeños' }}</strong><span>{{ metrics.modelWidthMm.toFixed(1) }} × {{ metrics.modelHeightMm.toFixed(1) }} mm · módulo {{ metrics.moduleSizeMm.toFixed(2) }} mm · recomendado {{ metrics.recommendedModuleMm.toFixed(2) }} mm o más</span><span v-if="!metrics.isPrintable">Puedes descargar el modelo, pero conviene usar una boquilla más fina o aumentar el tamaño del QR.</span></div>
        </div>
        <p class="print-note">Perfil preparado para FlashForge AD5X (cama de 220 × 220 mm). Importa el STL en Orca-Flashforge y asigna otro color al relieve o programa el cambio de filamento al comenzar el QR.</p>
        <div class="print-actions">
          <v-btn variant="tonal" :disabled="isSaving" @click="emit('download-svg')"><Download :size="18" /> Descargar SVG</v-btn>
          <v-btn color="primary" variant="flat" :loading="isSaving" @click="emit('download-stl')"><Download :size="18" /> Descargar STL</v-btn>
        </div>
      </div>
    </v-card>
  </v-dialog>
</template>

<style>
.print-dialog .dialog-header { display: flex; align-items: center; justify-content: space-between; padding: 18px 20px; border-bottom: 1px solid #e0e7ef; }
.print-dialog .dialog-header > div { display: flex; align-items: center; gap: 10px; }
.print-dialog .dialog-header h2 { margin: 0; font-size: 1.15rem; }
.print-dialog .dialog-header button { display: grid; width: 34px; height: 34px; place-items: center; background: transparent; border: 0; border-radius: 5px; cursor: pointer; }
.print-content { display: grid; gap: 20px; padding: 22px; }
.print-summary { display: grid; grid-template-columns: minmax(130px, .45fr) minmax(0, 1fr); gap: 14px; padding: 14px; background: #f4f7fa; border: 1px solid #dce5ef; border-radius: 7px; }
.print-summary > div { display: grid; gap: 4px; min-width: 0; }
.print-summary > div:last-child { grid-column: 1 / -1; }
.print-summary span { color: #68778c; font-size: .76rem; font-weight: 750; text-transform: uppercase; }
.print-summary code { overflow: hidden; color: #174b88; font-size: .82rem; text-overflow: ellipsis; white-space: nowrap; }
.print-controls { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.print-controls .field { display: grid; gap: 7px; color: #34445e; font-size: .88rem; font-weight: 700; }
.print-controls .field input, .print-controls .field select { width: 100%; min-height: 44px; padding: 0 12px; color: #121a2d; background: #fff; border: 1px solid #cdd9e7; border-radius: 6px; outline: 0; }
.print-controls .field input:focus, .print-controls .field select:focus { border-color: #0873ff; box-shadow: 0 0 0 3px rgba(8, 115, 255, .12); }
.print-metrics { display: flex; align-items: flex-start; gap: 12px; padding: 14px; color: #166b51; background: #eaf8f2; border: 1px solid #c7eadc; border-radius: 7px; }
.print-metrics--warning { color: #9a5b0c; background: #fff7e8; border-color: #f3d49f; }
.print-metrics > div { display: grid; gap: 3px; }
.print-metrics span { font-size: .84rem; line-height: 1.4; }
.print-note { margin: 0; color: #617189; font-size: .86rem; line-height: 1.45; }
.print-actions { display: flex; justify-content: flex-end; gap: 10px; }
.print-actions .v-btn { text-transform: none; font-weight: 700; letter-spacing: 0; }
.print-actions .v-btn__content { gap: 8px; }
@media (max-width: 720px) {
  .print-content { padding: 16px; }
  .print-summary, .print-controls { grid-template-columns: 1fr; }
  .print-summary > div:last-child { grid-column: auto; }
  .print-actions { display: grid; }
}
</style>
