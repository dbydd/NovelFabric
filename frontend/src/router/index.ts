import { createRouter, createWebHistory } from 'vue-router'
import ProjectHomeView from '../views/ProjectHomeView.vue'
import SimulationView from '../views/SimulationView.vue'
import WritingView from '../views/WritingView.vue'
import SettingsView from '../views/SettingsView.vue'
import MemoryView from '../views/MemoryView.vue'
import KnowledgeView from '../views/KnowledgeView.vue'
import ReportsView from '../views/ReportsView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'projects', component: ProjectHomeView },
    { path: '/project/:slug', redirect: (to) => `/project/${String(to.params.slug)}/simulation` },
    { path: '/project/:slug/simulation', name: 'simulation', component: SimulationView },
    { path: '/project/:slug/writing', name: 'writing', component: WritingView },
    { path: '/project/:slug/settings', name: 'settings', component: SettingsView },
    { path: '/project/:slug/memory', name: 'memory', component: MemoryView },
    { path: '/project/:slug/knowledge', name: 'knowledge', component: KnowledgeView },
    { path: '/project/:slug/reports', name: 'reports', component: ReportsView },
  ],
})

export default router
