export interface PrismaAdapter {
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
}

export type PrismaBaseClass = abstract new (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...args: any[]
) => PrismaAdapter;

export type PrismaClassConstructor = new (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...args: any[]
) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
  $connect: () => Promise<void>;
  $disconnect: () => Promise<void>;
};

export type AdapterFactory<TAdapter = unknown> = (connectionString: string) => TAdapter;

export interface CreatePrismaClientOptions {
  forceContainerFormat?: boolean;
}
