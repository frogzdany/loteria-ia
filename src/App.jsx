import { BrowserRouter, Route, Routes } from "react-router-dom";
import Home from "@/pages/Home";
import Generar from "@/pages/Generar";
import Griton from "@/pages/Griton";
import Tabla from "@/pages/Tabla";
import NotFound from "@/pages/NotFound";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/generar" element={<Generar />} />
        <Route path="/griton/:code" element={<Griton />} />
        <Route path="/tabla/:code" element={<Tabla />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
