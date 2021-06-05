


export interface PreparePool
{
   poolScratchOrgs(): Promise<{
    totalallocated: number;
    success: number;
    failed: number;
    errorCode?: string;
  }>
}
