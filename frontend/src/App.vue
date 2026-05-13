<script setup lang="ts">
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { computed } from 'vue'

const route = useRoute()
const projectSlug = computed(() => String(route.params.slug ?? ''))
const inProject = computed(() => Boolean(projectSlug.value))
</script>

<template>
  <div class="app-shell" data-testid="app-shell">
    <header class="app-header" data-testid="top-nav">
      <RouterLink class="brand" to="/" aria-label="NovelFabric projects" data-testid="nav-home-link">
        <span class="brand-mark" aria-hidden="true"></span>
        <span>NovelFabric</span>
      </RouterLink>
      <nav v-if="inProject" class="project-nav" aria-label="Project workspace navigation" data-testid="workspace-tabs">
        <RouterLink class="nf-tab" :to="`/project/${projectSlug}/simulation`" data-testid="tab-simulation">推演</RouterLink>
        <RouterLink class="nf-tab" :to="`/project/${projectSlug}/writing`" data-testid="tab-writing">创作</RouterLink>
        <RouterLink class="nf-tab" :to="`/project/${projectSlug}/settings`" data-testid="tab-settings">项目设定</RouterLink>
        <RouterLink class="nf-tab" :to="`/project/${projectSlug}/memory`" data-testid="tab-memory">记忆管理</RouterLink>
      </nav>
    </header>
    <main class="app-main" data-testid="main-content">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.app-shell { min-height: 100vh; display: flex; flex-direction: column; }
.app-header {
  height: var(--nf-header);
  display: flex;
  align-items: center;
  gap: var(--nf-space-5);
  padding: 0 var(--nf-space-4);
  background: var(--nf-sidebar);
  color: #fff;
  border-bottom: 1px solid #101722;
}
.brand { display: inline-flex; align-items: center; gap: 10px; color: #fff; text-decoration: none; font-weight: 900; letter-spacing: 0.02em; }
.brand-mark { width: 14px; height: 14px; border-radius: 4px; background: var(--nf-accent); display: inline-block; }
.project-nav { display: flex; align-items: center; gap: 4px; margin-left: auto; }
.nf-tab { color: #dce6f5; text-decoration: none; padding: 8px 12px; border-radius: 6px; font-weight: 700; }
.nf-tab:hover { background: var(--nf-sidebar-soft); }
.nf-tab.router-link-active { background: var(--nf-primary); color: #fff; }
.app-main { flex: 1; min-height: 0; }
</style>
