// Both generations expose these public sidebar APIs. Keep version selection here.
export const supportedGenerations=Object.freeze([13,14]);

export function resolveSidebarAdapter(foundry,config,generation) {
  if(!supportedGenerations.includes(generation)) throw new Error(`Scribe DM Copilot supports Foundry v13 and v14; found v${generation}.`);
  const api=foundry.applications?.api,sidebar=foundry.applications?.sidebar;
  const Sidebar=config.ui?.sidebar??sidebar?.Sidebar;
  if(typeof api?.HandlebarsApplicationMixin!=='function' || typeof sidebar?.AbstractSidebarTab!=='function' || !Sidebar?.TABS || !config.ui) throw new Error('Scribe DM Copilot could not find the supported Foundry sidebar APIs.');
  return {
    generation,
    Base:api.HandlebarsApplicationMixin(sidebar.AbstractSidebarTab),
    register(id,Tab) {
      if(config.ui[id]) throw new Error(`Sidebar tab ${id} is already registered.`);
      config.ui[id]=Tab;
      Sidebar.TABS[id]={icon:'fas fa-scroll',tooltip:'DM Copilot',gmOnly:true};
    }
  };
}
