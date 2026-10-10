<script setup>
import { KeyRound, Save, ShieldCheck, Users, X } from '@lucide/vue'

/* eslint-disable vue/no-mutating-props -- draft is the shared form state owned by AdminApp. */
defineProps({
  modelValue: { type: Boolean, default: false },
  draft: { type: Object, required: true },
  categories: { type: Array, required: true },
  clients: { type: Array, required: true },
  displayNameMaxLength: { type: Number, required: true },
  isSaving: { type: Boolean, default: false },
  buildUrl: { type: Function, required: true },
})

const emit = defineEmits(['update:modelValue', 'submit'])
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="620" @update:model-value="emit('update:modelValue', $event)">
    <v-card class="admin-dialog">
      <div class="dialog-header"><div><Users :size="21" /><h2>{{ draft.id ? 'Editar entidad' : 'Nueva entidad' }}</h2></div><button type="button" @click="emit('update:modelValue', false)"><X :size="21" /></button></div>
      <form @submit.prevent="emit('submit')">
        <label class="field"><span>Nombre visible</span><input v-model="draft.displayName" :maxlength="displayNameMaxLength" placeholder="Ej. Max, ABC-123 o Maleta azul" /></label>
        <label class="field"><span>Categoría</span><select v-model="draft.categoryId"><option v-for="category in categories" :key="category.id" :value="category.id">{{ category.name }} ({{ category.code }})</option></select></label>
        <label class="field"><span>Cliente <small>Opcional</small></span><select v-model="draft.clienteId"><option :value="null">Sin cliente (solo lectura)</option><option v-for="client in clients" :key="client.id" :value="client.id">{{ client.name }} · {{ client.email }}</option><option value="new">＋ Nuevo cliente…</option></select></label>
        <template v-if="draft.clienteId === 'new'">
          <label class="field"><span>Nombre del cliente</span><input v-model="draft.newClient.name" maxlength="100" autocomplete="name" placeholder="Ej. Carlos Mendoza" /></label>
          <label class="field"><span>Correo de acceso</span><input v-model="draft.newClient.email" maxlength="254" type="email" autocomplete="email" placeholder="nombre@correo.com" /></label>
          <label class="field"><span>Número de celular <small>Opcional</small></span><input v-model="draft.newClient.phone" maxlength="30" type="tel" autocomplete="tel" placeholder="Ej. +57 300 000 0000" /></label>
        </template>
        <div class="guid-preview"><ShieldCheck :size="19" /><p><strong>Acceso a modificaciones</strong><span>{{ draft.clienteId ? 'El cliente recibe el código para ver datos protegidos y administrar todas sus fichas.' : 'Sin cliente, la ficha pública permanecerá en modo solo lectura.' }}</span></p></div>
        <div v-if="!draft.id" class="guid-preview"><KeyRound :size="19" /><p><strong>Acceso seguro automático</strong><span>Se generará un GUID interno y un código corto para la URL.</span></p></div>
        <div v-else class="url-preview"><span>URL actual</span><code>{{ buildUrl(categories.find((item) => item.id === Number(draft.categoryId))?.code, draft.shortCode || draft.token, Boolean(draft.shortCode)) }}</code></div>
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
.field small { color: #718097; font-weight: 500; }
.guid-preview { display: flex; gap: 11px; padding: 13px; color: #174b88; background: #f0f7ff; border: 1px solid #cfe4fb; border-radius: 6px; }
.guid-preview p { display: grid; gap: 3px; margin: 0; }
.guid-preview span { color: #62748e; font-size: .82rem; font-weight: 500; }
.url-preview { display: grid; gap: 7px; padding: 13px; background: #f4f7fa; border: 1px solid #dce5ef; border-radius: 6px; }
.url-preview span { color: #68778c; font-size: .8rem; font-weight: 750; }
.url-preview code { overflow-wrap: anywhere; color: #174b88; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 5px; }
.dialog-actions .v-btn { text-transform: none; font-weight: 700; letter-spacing: 0; }
.dialog-actions .v-btn__content { gap: 8px; }
</style>
