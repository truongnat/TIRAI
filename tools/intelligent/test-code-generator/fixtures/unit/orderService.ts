export class OrderService {
  total(items: number[]): number {
    return items.reduce((sum, n) => sum + n, 0);
  }
}
