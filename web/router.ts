import { createRouter, createWebHistory } from 'vue-router'
import Login from './pages/Login.vue'
import Register from './pages/Register.vue'
import Entries from './pages/Entries.vue'
import NewEntry from './pages/NewEntry.vue'
import Entry from './pages/Entry.vue'
import Admin from './pages/Admin.vue'
import Setup from './pages/Setup.vue'
import { loadMe, me, refresh, setupState } from './api'

// meta.bare: no top bar (auth pages). meta.ownMobileHeader: page draws its own header below md. meta.admin: bot-admins only.
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/setup', component: Setup, meta: { bare: true } },
    { path: '/login', component: Login, meta: { bare: true } },
    { path: '/register', component: Register, meta: { bare: true } },
    { path: '/', component: Entries },
    { path: '/new', component: NewEntry },
    { path: '/entries/:id', component: Entry, meta: { ownMobileHeader: true } },
    { path: '/admin', component: Admin, meta: { admin: true } },
  ],
  scrollBehavior: () => ({ top: 0 }),
})

// First run → setup. Then login → register real name → app. Lists are refetched on every navigation (small team, cheap).
router.beforeEach(async (to) => {
  if (setupState.needed === undefined) setupState.needed = (await fetch('/api/setup/status').then((r) => r.json()).catch(() => ({ needed: false }))).needed
  if (setupState.needed) return to.path === '/setup' || '/setup'
  if (to.path === '/setup') return '/login'
  if (to.path === '/login') return
  if (!me.discord_id && !(await loadMe())) return '/login'
  if (!me.real_name) return to.path === '/register' || '/register'
  if (to.meta.admin && !me.is_admin) return '/'
  if (to.path !== '/register') await refresh()
})
