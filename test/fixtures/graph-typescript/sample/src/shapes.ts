export class Circle {
  area(): number {
    return 3;
  }
}
export class Square {
  area(): number {
    return 4;
  }
}
export interface Config {
  name: string;
}
export namespace Config {
  export const fallback = "none";
}
