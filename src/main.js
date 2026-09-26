import { createApp } from 'vue'
import App from './App.vue'
import AdminApp from './AdminApp.vue'
import vuetify from './plugins/vuetify'
import './styles/main.css'

const isAdminRoute = window.location.pathname.replace(/\/+$/, '') === '/admin'

createApp(isAdminRoute ? AdminApp : App).use(vuetify).mount('#app')
