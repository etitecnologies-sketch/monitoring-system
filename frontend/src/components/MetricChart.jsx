import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

export default function MetricChart({ history }) {
  const data = history.map((h) => ({
    ...h,
    time: new Date(h.time).toLocaleTimeString(),
    cpu: parseFloat(h.cpu.toFixed(1)),
    memory: parseFloat(h.memory.toFixed(1)),
  }));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
        <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
        <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 10 }} />
        <Tooltip formatter={(v) => `${v}%`} />
        <Legend />
        <Line
          type="monotone"
          dataKey="cpu"
          stroke="#3b82f6"
          dot={false}
          strokeWidth={2}
          name="CPU"
        />
        <Line
          type="monotone"
          dataKey="memory"
          stroke="#f59e0b"
          dot={false}
          strokeWidth={2}
          name="Memory"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
