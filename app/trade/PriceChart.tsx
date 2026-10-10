"use client";

import { useEffect, useRef } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { PricePoint } from "@/lib/markets";

/**
 * Simulated price chart drawn with TradingView's open-source Lightweight
 * Charts. It plots OUR simulated closes, so the chart always matches the
 * price an order is checked against. Cents become dollars for display only.
 */
export function PriceChart({ points, rising, label }: { points: PricePoint[]; rising: boolean; label: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | null = null;
    void import("lightweight-charts").then(({ createChart, AreaSeries, ColorType, LineStyle }) => {
      const host = hostRef.current;
      if (disposed || !host) return;
      const chart = createChart(host, {
        autoSize: true,
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: "rgba(235, 240, 245, 0.45)",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif",
          fontSize: 11,
          attributionLogo: true,
        },
        grid: {
          vertLines: { visible: false },
          horzLines: { color: "rgba(255, 255, 255, 0.05)", style: LineStyle.Dashed },
        },
        rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
        timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true },
        crosshair: {
          vertLine: { color: "rgba(140, 185, 204, 0.4)", labelBackgroundColor: "#00638e" },
          horzLine: { color: "rgba(140, 185, 204, 0.4)", labelBackgroundColor: "#00638e" },
        },
        handleScroll: false,
        handleScale: false,
      });
      chartRef.current = chart;
      seriesRef.current = chart.addSeries(AreaSeries, {
        lineWidth: 2,
        priceLineStyle: LineStyle.Dashed,
        priceFormat: { type: "price", precision: 2, minMove: 0.01 },
      });
      observer = new ResizeObserver(() => chart.timeScale().fitContent());
      observer.observe(host);
      draw();
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      chartRef.current?.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
    // The chart is created once; data changes are applied by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function draw() {
    const series = seriesRef.current;
    if (!series) return;
    const line = rising ? "#8cb9cc" : "#ff9b93";
    series.applyOptions({
      lineColor: line,
      topColor: rising ? "rgba(0, 99, 142, 0.45)" : "rgba(255, 155, 147, 0.28)",
      bottomColor: "rgba(0, 0, 0, 0)",
      priceLineColor: line,
    });
    // One point per UTC day, ascending (the last point is the current price).
    const byDay = new Map<string, number>();
    for (const p of points) byDay.set(p.date, p.closeCents / 100);
    series.setData([...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([time, value]) => ({ time, value })));
    chartRef.current?.timeScale().fitContent();
  }

  useEffect(draw);

  return <div ref={hostRef} className="trade-chart" role="img" aria-label={label} />;
}
