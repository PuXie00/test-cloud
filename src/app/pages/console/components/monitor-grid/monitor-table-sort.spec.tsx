// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SortableMonitorHeader, sortMonitorRows, useMonitorSort } from "./monitor-table-sort";

afterEach(cleanup);

describe("监控表格排序", () => {
  it("按原始数值排序，重复值稳定，升降序都把无效读数放在最后", () => {
    const rows = [
      { id: 1, value: null }, { id: 2, value: 10 }, { id: 3, value: 2 },
      { id: 4, value: 2 }, { id: 5, value: -1 }, { id: 6, value: NaN },
    ];
    const value = (row: typeof rows[number]) => row.value;
    expect(sortMonitorRows(rows, null, value)).toBe(rows);
    expect(sortMonitorRows(rows, { key: "value", direction: "ascending" }, value).map(row => row.id))
      .toEqual([5, 3, 4, 2, 1, 6]);
    expect(sortMonitorRows(rows, { key: "value", direction: "descending" }, value).map(row => row.id))
      .toEqual([2, 3, 4, 5, 1, 6]);
    expect(rows.map(row => row.id)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("支持带数字的名称，数值列不会跨单位分组比较", () => {
    const names = ["吊杆10", "吊杆1", "吊杆2"];
    expect(sortMonitorRows(names, { key: "name", direction: "ascending" }, name => name))
      .toEqual(["吊杆1", "吊杆2", "吊杆10"]);
    const rows = [{ unit: "b", value: -1 }, { unit: "a", value: 2 }, { unit: "a", value: 10 }];
    expect(sortMonitorRows(rows, { key: "h", direction: "descending" }, row => row.value, row => row.unit))
      .toEqual([rows[2], rows[1], rows[0]]);
  });

  it("每次只标示当前排序列，第三次点击恢复原顺序，切列从升序开始", () => {
    function Table() {
      const [sort, onSort] = useMonitorSort();
      return <table><thead><tr>{["名称", "状态"].map(label =>
        <SortableMonitorHeader key={label} columnKey={label} label={label} sort={sort} onSort={onSort} />
      )}</tr></thead></table>;
    }
    render(<Table />);
    const name = screen.getByRole("button", { name: "名称" });
    const status = screen.getByRole("button", { name: "状态" });
    const sorted = () => screen.getAllByRole("columnheader").filter(th => th.hasAttribute("aria-sort"));
    expect(sorted()).toHaveLength(0);
    fireEvent.click(status);
    fireEvent.click(name);
    expect(sorted()).toEqual([name.closest("th")]);
    expect(sorted()[0].getAttribute("aria-sort")).toBe("ascending");
    fireEvent.click(name);
    expect(sorted()[0].getAttribute("aria-sort")).toBe("descending");
    fireEvent.click(name);
    expect(sorted()).toHaveLength(0);
  });
});
