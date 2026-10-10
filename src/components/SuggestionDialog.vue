<script setup>
import { Lightbulb, Save, X } from '@lucide/vue'

/* eslint-disable vue/no-mutating-props -- draft is the shared form state owned by AdminApp. */
defineProps({
  modelValue: { type: Boolean, default: false },
  draft: { type: Object, required: true },
  dataTypes: { type: Array, required: true },
  isSaving: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue', 'submit'])
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="520" @update:model-value="emit('update:modelValue', $event)">
    <v-card class="admin-dialog">
      <div class="dialog-header">
        <div><Lightbulb :size="21" /><h2>{{ draft.id ? 'Editar sugerencia' : 'Nueva sugerencia' }}</h2></div>
        <button type="button" @click="emit('update:modelValue', false)"><X :size="21" /></button>
      </div>
      <form @submit.prevent="emit('submit')">
        <label class="field"><span>Dato sugerido</span><input v-model="draft.name" maxlength="50" placeholder="Ej. Vencimiento SOAT" /></label>
        <label class="field"><span>Tipo de información</span><select v-model="draft.dataType"><option v-for="type in dataTypes" :key="type.value" :value="type.value">{{ type.label }}</option></select></label>
        <label class="field"><span>Orden</span><input v-model.number="draft.sortOrder" min="0" max="9999" type="number" /></label>
        <label class="switch-field"><input v-model="draft.active" type="checkbox" /><span><strong>Sugerencia activa</strong><small>Visible para entidades sin datos.</small></span></label>
        <div class="dialog-actions"><v-btn variant="text" @click="emit('update:modelValue', false)">Cancelar</v-btn><v-btn color="primary" :loading="isSaving" type="submit" variant="flat"><Save :size="18" /> Guardar</v-btn></div>
      </form>
    </v-card>
  </v-dialog>
</template>

<style>
.admin-dialog { padding: 0; border-radius: 8px !important; }
.dialog-header { display: flex; align-items: center; justify-content: space-between; padding: 18px 20px; border-bottom: 1px solid #e0e7ef; }
.dialog-header > div { display: flex; align-items: center; gap: 10px; }
.dialog-header h2 { margin: 0; font-size: 1.15rem; }
.dialog-header button { display: grid; width: 34px; height: 34px; place-items: center; background: transparent; border: 0; border-radius: 5px; cursor: pointer; }
.admin-dialog form { display: grid; gap: 17px; padding: 20px; }
.field { display: grid; gap: 7px; color: #34445e; font-size: .88rem; font-weight: 700; }
.field input, .field select { width: 100%; min-height: 44px; padding: 0 12px; color: #121a2d; background: #fff; border: 1px solid #cdd9e7; border-radius: 6px; outline: 0; }
.field input:focus, .field select:focus { border-color: #0873ff; box-shadow: 0 0 0 3px rgba(8, 115, 255, .12); }
.switch-field { display: flex; align-items: center; gap: 11px; }
.switch-field input { width: 18px; height: 18px; accent-color: #0873ff; }
.switch-field span { display: grid; }
.switch-field small { color: #718097; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 5px; }
.dialog-actions .v-btn { text-transform: none; font-weight: 700; letter-spacing: 0; }
.dialog-actions .v-btn__content { gap: 8px; }
</style>
