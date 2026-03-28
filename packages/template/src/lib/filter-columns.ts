/**
 * Server-side filter-to-SQL translation for DiceUI data-table.
 *
 * Converts column filter state from the frontend (via URL params)
 * into Drizzle ORM WHERE conditions. Supports text search, numeric
 * comparison, date ranges, multi-select, and boolean filters.
 *
 * Adapted from tablecn/shadcn-table reference implementation.
 */
import { addDays, endOfDay, startOfDay } from 'date-fns';
import {
  type AnyColumn,
  and,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  not,
  notIlike,
  notInArray,
  or,
  type SQL,
  type Table,
} from 'drizzle-orm';

import type { ExtendedColumnFilter, JoinOperator } from '@/types/data-table';

function getColumn<T extends Table>(table: T, columnKey: keyof T): AnyColumn {
  return table[columnKey] as AnyColumn;
}

function isEmpty(column: AnyColumn): SQL {
  const condition = or(isNull(column), eq(column, ''));
  // or() with two args always returns SQL, never undefined
  return condition as SQL;
}

export function filterColumns<T extends Table>({
  table,
  filters,
  joinOperator,
}: {
  table: T;
  filters: ExtendedColumnFilter<T>[];
  joinOperator: JoinOperator;
}): SQL | undefined {
  const joinFn = joinOperator === 'and' ? and : or;

  const conditions = filters.map((filter) => {
    const column = getColumn(table, filter.id);

    switch (filter.operator) {
      case 'iLike':
        return filter.variant === 'text' && typeof filter.value === 'string'
          ? ilike(column, `%${filter.value}%`)
          : undefined;

      case 'notILike':
        return filter.variant === 'text' && typeof filter.value === 'string'
          ? notIlike(column, `%${filter.value}%`)
          : undefined;

      case 'eq':
        if (column.dataType === 'boolean' && typeof filter.value === 'string') {
          return eq(column, filter.value === 'true');
        }
        if (filter.variant === 'date' || filter.variant === 'dateRange') {
          const date = new Date(Number(filter.value));
          return and(
            gte(column, startOfDay(date)),
            lte(column, endOfDay(date)),
          );
        }
        return eq(column, filter.value);

      case 'ne':
        if (column.dataType === 'boolean' && typeof filter.value === 'string') {
          return ne(column, filter.value === 'true');
        }
        if (filter.variant === 'date' || filter.variant === 'dateRange') {
          const date = new Date(Number(filter.value));
          return or(lt(column, startOfDay(date)), gt(column, endOfDay(date)));
        }
        return ne(column, filter.value);

      case 'inArray':
        return Array.isArray(filter.value)
          ? inArray(column, filter.value)
          : undefined;

      case 'notInArray':
        return Array.isArray(filter.value)
          ? notInArray(column, filter.value)
          : undefined;

      case 'lt':
        if (filter.variant === 'date' && typeof filter.value === 'string') {
          return lt(column, endOfDay(new Date(Number(filter.value))));
        }
        return lt(column, filter.value);

      case 'lte':
        if (filter.variant === 'date' && typeof filter.value === 'string') {
          return lte(column, endOfDay(new Date(Number(filter.value))));
        }
        return lte(column, filter.value);

      case 'gt':
        if (filter.variant === 'date' && typeof filter.value === 'string') {
          return gt(column, startOfDay(new Date(Number(filter.value))));
        }
        return gt(column, filter.value);

      case 'gte':
        if (filter.variant === 'date' && typeof filter.value === 'string') {
          return gte(column, startOfDay(new Date(Number(filter.value))));
        }
        return gte(column, filter.value);

      case 'isBetween':
        if (
          (filter.variant === 'date' || filter.variant === 'dateRange') &&
          Array.isArray(filter.value) &&
          filter.value.length === 2
        ) {
          return and(
            filter.value[0]
              ? gte(column, startOfDay(new Date(Number(filter.value[0]))))
              : undefined,
            filter.value[1]
              ? lte(column, endOfDay(new Date(Number(filter.value[1]))))
              : undefined,
          );
        }
        if (
          (filter.variant === 'number' || filter.variant === 'range') &&
          Array.isArray(filter.value) &&
          filter.value.length === 2
        ) {
          const lo =
            filter.value[0]?.trim() !== '' ? Number(filter.value[0]) : null;
          const hi =
            filter.value[1]?.trim() !== '' ? Number(filter.value[1]) : null;
          if (lo === null && hi === null) return undefined;
          if (lo !== null && hi === null) return eq(column, lo);
          if (lo === null && hi !== null) return eq(column, hi);
          return and(
            lo !== null ? gte(column, lo) : undefined,
            hi !== null ? lte(column, hi) : undefined,
          );
        }
        return undefined;

      case 'isRelativeToToday':
        if (
          (filter.variant === 'date' || filter.variant === 'dateRange') &&
          typeof filter.value === 'string'
        ) {
          const today = new Date();
          const [amount, unit] = filter.value.split(' ') ?? [];
          if (!amount || !unit) return undefined;

          let start: Date;
          let end: Date;
          switch (unit) {
            case 'days':
              start = startOfDay(addDays(today, Number.parseInt(amount, 10)));
              end = endOfDay(start);
              break;
            case 'weeks':
              start = startOfDay(
                addDays(today, Number.parseInt(amount, 10) * 7),
              );
              end = endOfDay(addDays(start, 6));
              break;
            case 'months':
              start = startOfDay(
                addDays(today, Number.parseInt(amount, 10) * 30),
              );
              end = endOfDay(addDays(start, 29));
              break;
            default:
              return undefined;
          }
          return and(gte(column, start), lte(column, end));
        }
        return undefined;

      case 'isEmpty':
        return isEmpty(column);

      case 'isNotEmpty':
        return not(isEmpty(column));

      default:
        return undefined;
    }
  });

  const valid = conditions.filter(Boolean);
  return valid.length > 0 ? joinFn(...valid) : undefined;
}
