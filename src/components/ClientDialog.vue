<script setup>
import { Contact, Save, ShieldCheck, X } from '@lucide/vue'

/* eslint-disable vue/no-mutating-props -- draft is the shared form state owned by AdminApp. */
defineProps({
  modelValue: { type: Boolean, default: false },
  draft: { type: Object, required: true },
  isSaving: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue', 'submit'])
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="520" @update:model-value="emit('update:modelValue', $event)">
    <v-card class="admin-dialog">
      <div class="dialog-header"><div><Contact :size="21" /><h2>{{ draft.id ? 'Editar cliente' : 'Nuevo cliente' }}</h2></div><button type="button" @click="emit('update:modelValue', false)"><X :size="21" /></button></div>
      <form @submit.prevent="emit('submit')">
        <label class="field"><span>Nombre</span><input v-model="draft.name" maxlength="100" autocomplete="name" placeholder="Ej. Carlos Mendoza" /></label>
        <label class="field"><span>Correo de acceso</span><input v-model="draft.email" maxlength="254" type="email" autocomplete="email" placeholder="nombre@correo.com" /></label>
        <label class="field"><span>Número de celular <small>Opcional</small></span><input v-model="draft.phone" maxlength="30" type="tel" autocomplete="tel" placeholder="Ej. +57 300 000 0000" /></label>
        <label class="switch-field"><input v-model="draft.active" type="checkbox" /><span><strong>Cliente activo</strong><small>Si lo desactivas, sus fichas quedan en solo lectura sin borrar nada.</small></span></label>
        <div class="guid-preview"><ShieldCheck :size="19" /><p><strong>Acceso del cliente</strong><span>Con este correo administra todas sus fichas. Cambiarlo cierra sus sesiones abiertas.</span></p></div>
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
.field input { width: 100%; min-height: 44px; padding: 0 12px; color: #121a2d; background: #fff; border: 1px solid #cdd9e7; border-radius: 6px; outline: 0; }
.field input:focus { border-color: #0873ff; box-shadow: 0 0 0 3px rgba(8, 115, 255, .12); }
.field small { color: #718097; font-weight: 500; }
.switch-field { display: flex; align-items: center; gap: 11px; }
.switch-field input { width: 18px; height: 18px; accent-color: #0873ff; }
.switch-field span { display: grid; }
.switch-field small { color: #718097; }
.guid-preview { display: flex; gap: 11px; padding: 13px; color: #174b88; background: #f0f7ff; border: 1px solid #cfe4fb; border-radius: 6px; }
.guid-preview p { display: grid; gap: 3px; margin: 0; }
.guid-preview span { color: #62748e; font-size: .82rem; font-weight: 500; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 5px; }
.dialog-actions .v-btn { text-transform: none; font-weight: 700; letter-spacing: 0; }
.dialog-actions .v-btn__content { gap: 8px; }
</style>
