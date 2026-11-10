let validatedEmptyBootstrap=false;

export const isValidatedEmptyBootstrap=():boolean=>validatedEmptyBootstrap;

/** Called only by the one-shot entry point after it verifies there are no public tables. */
export async function withValidatedEmptyBootstrap<T>(createContext:()=>Promise<T>):Promise<T> {
  if(validatedEmptyBootstrap) throw new Error('An empty-database bootstrap is already active');
  validatedEmptyBootstrap=true;
  try{return await createContext();}
  finally{validatedEmptyBootstrap=false;}
}
