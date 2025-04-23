import Slop, {
  type SlopRequest,
  type SlopResponse,
  type NextFunction,
} from "./index";
import { staticFiles } from "./libslop/middleware/staticfiles";
const app = new Slop();

app.use((req: SlopRequest, res: SlopResponse, next: NextFunction) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

app.use(staticFiles("web", { spaMode: true }));

app.get("/users/:id", (req: SlopRequest, res: SlopResponse) => {
  res.json({
    userId: req.params.id,
    message: `Fetched user ${req.params.id}`,
  });
});

app.post("/users", async (req: SlopRequest, res: SlopResponse) => {
  const userData = req.body;
  res.status(201).json({
    message: "User created",
    user: userData,
  });
});

app.use((err, req: SlopRequest, res: SlopResponse, next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong!" });
});

app.listen(3000, () => {
  console.log("SlopJS server running on http://localhost:3000");
});
