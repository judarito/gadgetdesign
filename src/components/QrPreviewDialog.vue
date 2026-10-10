<script setup>
import { Printer, QrCode, X } from '@lucide/vue'

defineProps({
  modelValue: Boolean,
  entity: { type: Object, default: null },
  imageUrl: { type: String, default: '' },
  entityUrl: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'prepare-print'])
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="460" @update:model-value="emit('update:modelValue', $event)">
    <v-card class="admin-dialog qr-dialog">
      <div class="dialog-header">
        <div><QrCode :size="21" /><h2>Código QR</h2></div>
        <button type="button" aria-label="Cerrar" @click="emit('update:modelValue', false)"><X :size="21" /></button>
      </div>
      <div v-if="entity" class="qr-content">
        <img :src="imageUrl" :alt="`Código QR de ${entity.displayName}`" />
        <div><strong>{{ entity.displayName }}</strong><a :href="entityUrl" target="_blank">{{ entityUrl }}</a></div>
        <v-btn color="primary" variant="flat" @click="emit('prepare-print', entity)"><Printer :size="18" /> Preparar impresión 3D</v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>

<style>
.qr-content { display: grid; justify-items: center; gap: 18px; padding: 22px; }
.qr-content img { width: min(100%, 320px); aspect-ratio: 1; object-fit: contain; background: #fff; border: 1px solid #dce5ef; border-radius: 6px; }
.qr-content > div { display: grid; gap: 5px; max-width: 100%; text-align: center; }
.qr-content a { max-width: 100%; color: #096bdc; font-size: .84rem; overflow-wrap: anywhere; }
.qr-content .v-btn { text-transform: none; font-weight: 700; letter-spacing: 0; }
.qr-content .v-btn__content { gap: 8px; }
</style>
