export interface PartitionResult {
  even: number[];
  odd: number[];
}

export function partition(numbers: number[]): PartitionResult {
  return {
    even: numbers.filter((n) => n % 2 === 0),
    odd: numbers.filter((n) => n % 2 !== 0),
  };
}
