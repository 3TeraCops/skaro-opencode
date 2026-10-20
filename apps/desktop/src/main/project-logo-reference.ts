/** UI references are composed at the desktop boundary; the domain store keeps actual logo data. */
export function logoReference(project: {
  id: string;
  logoVersion?: number;
  logo?: string;
}): string | undefined {
  return project.logoVersion === undefined
    ? project.logo
    : `skaro-logo://project/${project.id}?v=${project.logoVersion}`;
}
