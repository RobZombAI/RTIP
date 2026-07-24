//
// RTIP v2 — C++ HTTP Server
// Serves frontend, manages workers, proxies API calls.
// Build: c++ -std=c++17 -O2 main.cpp -o rtip-server -lpthread
//
#include <iostream>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>
#include <thread>
#include <chrono>
#include <csignal>
#include <cstdlib>
#include <unistd.h>
#include <sys/wait.h>
#include <sys/stat.h>
#include <pwd.h>

#include <httplib.h>
#include <nlohmann/json.hpp>

using json = nlohmann::json;

// ── Globals ──
static pid_t g_llama_pid = -1;
static pid_t g_ocr_pid = -1;
static pid_t g_timelens_pid = -1;
static std::string g_home;
static std::string g_venv_python;
static std::string g_server_dir;
static std::string g_workers_dir;
static std::string g_llm_model;
static std::string g_sessions_dir;
static std::string g_uploads_dir;
static int g_ram_gb = 0;

// ── Helpers ──
static std::string slurp(const std::string& path) {
    std::ifstream f(path);
    return std::string((std::istreambuf_iterator<char>(f)),
                        std::istreambuf_iterator<char>());
}

static void write_file(const std::string& path, const std::string& data) {
    std::ofstream f(path);
    f << data;
}

static bool file_exists(const std::string& path) {
    struct stat st;
    return stat(path.c_str(), &st) == 0;
}

static int get_ram_gb() {
    FILE* fp = popen("sysctl -n hw.memsize 2>/dev/null", "r");
    if (!fp) return 8;
    char buf[64];
    if (!fgets(buf, sizeof(buf), fp)) { pclose(fp); return 8; }
    pclose(fp);
    return (int)(atoll(buf) / 1073741824);
}

// ── Process management ──
static pid_t spawn(const std::string& cmd, const std::vector<std::string>& args, bool detach=true) {
    pid_t pid = fork();
    if (pid == 0) {
        std::vector<const char*> cargs;
        cargs.push_back(cmd.c_str());
        for (const auto& a : args) cargs.push_back(a.c_str());
        cargs.push_back(nullptr);

        if (detach) {
            // Redirect stdout/stderr to log
            std::string logpath = g_home + "/.rtip.log";
            FILE* log = freopen(logpath.c_str(), "a", stdout);
            if (log) freopen(logpath.c_str(), "a", stderr);
        }

        execvp(cmd.c_str(), const_cast<char**>(cargs.data()));
        _exit(1);
    }
    return pid;
}

static bool is_alive(pid_t pid) {
    return pid > 0 && waitpid(pid, nullptr, WNOHANG) == 0;
}

static void kill_proc(pid_t pid) {
    if (pid <= 0) return;
    kill(pid, SIGTERM);
    for (int i = 0; i < 10; i++) {
        if (!is_alive(pid)) return;
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    kill(pid, SIGKILL);
    waitpid(pid, nullptr, 0);
}

static void kill_all_by_name(const std::string& name) {
    std::string cmd = "pkill -f '" + name + "' 2>/dev/null || true";
    system(cmd.c_str());
}

// ── Signal handler ──
static void shutdown(int) {
    std::cerr << "\n[RTIP] Shutting down..." << std::endl;
    kill_proc(g_llama_pid);
    kill_proc(g_ocr_pid);
    kill_proc(g_timelens_pid);
    _exit(0);
}

// ── HTTP client helper ──
static httplib::Client make_client(int port) {
    httplib::Client cli("127.0.0.1", port);
    cli.set_connection_timeout(5);
    cli.set_read_timeout(600);
    return cli;
}

// ── Sessions ──
static json load_sessions() {
    std::string idx_path = g_sessions_dir + "/index.json";
    if (!file_exists(idx_path)) return json::array();
    try { return json::parse(slurp(idx_path)); }
    catch (...) { return json::array(); }
}

static void save_sessions(const json& sessions) {
    write_file(g_sessions_dir + "/index.json", sessions.dump(2));
}

// ── Run Python one-liner and return stdout ──
static std::string run_python(const std::string& code) {
    std::string cmd = g_venv_python + " -c \"" + code + "\" 2>/dev/null";
    FILE* fp = popen(cmd.c_str(), "r");
    if (!fp) return "";
    std::string out;
    char buf[8192];
    while (fgets(buf, sizeof(buf), fp)) out += buf;
    pclose(fp);
    return out;
}

// ═══════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════
int main() {
    signal(SIGINT, shutdown);
    signal(SIGTERM, shutdown);

    // Paths
    struct passwd* pw = getpwuid(getuid());
    g_home = pw ? pw->pw_dir : "/Users/robzomb";
    g_venv_python = g_home + "/qwen3-tts-ui/venv/bin/python3";
    g_server_dir = g_home + "/RTIP/server";
    g_workers_dir = g_home + "/RTIP/workers";
    g_sessions_dir = g_home + "/rtip-ocr/sessions";
    g_uploads_dir = g_home + "/rtip-ocr/uploads";
    g_llm_model = g_home + "/Downloads/Agents-A1-Q8_0.gguf";
    g_ram_gb = get_ram_gb();

    mkdir(g_sessions_dir.c_str(), 0755);
    mkdir(g_uploads_dir.c_str(), 0755);

    // Kill old instances
    kill_all_by_name("llama-server");
    kill_all_by_name("ocr_worker.py");
    kill_all_by_name("timelens_worker.py");
    std::this_thread::sleep_for(std::chrono::seconds(1));

    // Start llama-server
    if (file_exists(g_llm_model)) {
        g_llama_pid = spawn("llama-server", {
            "--model", g_llm_model,
            "--host", "127.0.0.1", "--port", "8081",
            "--temp", "0.1", "--ctx-size", "32768",
            "-ngl", "99", "--parallel", "1",
            "--cont-batching", "--mlock"
        });
        std::cout << "[RTIP] llama-server PID " << g_llama_pid << std::endl;
    }

    // Start OCR worker
    g_ocr_pid = spawn(g_venv_python, {g_workers_dir + "/ocr_worker.py", "--port", "9101"});
    std::cout << "[RTIP] OCR worker PID " << g_ocr_pid << std::endl;

    // Start TimeLens worker
    if (g_ram_gb >= 20) {
        g_timelens_pid = spawn(g_venv_python, {g_workers_dir + "/timelens_worker.py", "--port", "9102"});
        std::cout << "[RTIP] TimeLens worker PID " << g_timelens_pid << std::endl;
    }

    std::this_thread::sleep_for(std::chrono::seconds(2));

    // Worker health-check thread: respawn dead workers
    std::thread health_thread([&]() {
        while (true) {
            std::this_thread::sleep_for(std::chrono::seconds(10));
            if (!is_alive(g_ocr_pid)) {
                std::cout << "[RTIP] OCR worker dead, respawning..." << std::endl;
                kill_proc(g_ocr_pid);
                g_ocr_pid = spawn(g_venv_python, {g_workers_dir + "/ocr_worker.py", "--port", "9101"});
            }
            if (g_ram_gb >= 20 && !is_alive(g_timelens_pid)) {
                std::cout << "[RTIP] TimeLens worker dead, respawning..." << std::endl;
                kill_proc(g_timelens_pid);
                g_timelens_pid = spawn(g_venv_python, {g_workers_dir + "/timelens_worker.py", "--port", "9102"});
            }
            if (!is_alive(g_llama_pid) && file_exists(g_llm_model)) {
                std::cout << "[RTIP] llama-server dead, respawning..." << std::endl;
                kill_proc(g_llama_pid);
                g_llama_pid = spawn("llama-server", {
                    "--model", g_llm_model,
                    "--host", "127.0.0.1", "--port", "8081",
                    "--temp", "0.1", "--ctx-size", "32768",
                    "-ngl", "99", "--parallel", "1",
                    "--cont-batching", "--mlock"
                });
            }
        }
    });
    health_thread.detach();

    // ── HTTP server ──
    httplib::Server svr;

    svr.set_pre_routing_handler([](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
        res.set_header("Access-Control-Allow-Headers", "Content-Type");
        if (req.method == "OPTIONS") return httplib::Server::HandlerResponse::Handled;
        return httplib::Server::HandlerResponse::Unhandled;
    });

    svr.set_mount_point("/", g_server_dir + "/frontend");

    // ── API: Status ──
    svr.Get("/api/status", [](const httplib::Request&, httplib::Response& res) {
        json s = {
            {"llm",         is_alive(g_llama_pid)},
            {"ocr",         is_alive(g_ocr_pid)},
            {"timelens",    is_alive(g_timelens_pid)},
            {"llm_model",   file_exists(g_llm_model)},
        };
        // Check TimeLens actual model status from worker
        if (is_alive(g_timelens_pid)) {
            auto cli = make_client(9102);
            auto r = cli.Get("/");
            if (r) {
                try {
                    auto tl = json::parse(r->body);
                    s["timelens_status"] = tl.value("status", "unknown");
                    s["timelens_message"] = tl.value("message", "");
                } catch (...) {}
            }
        }
        res.set_content(s.dump(), "application/json");
    });

    // ── API: System info ──
    svr.Get("/api/system", [](const httplib::Request&, httplib::Response& res) {
        json info = {
            {"ram_gb", g_ram_gb},
            {"ocr", true},
            {"llm", file_exists(g_llm_model)},
            {"timelens", g_ram_gb >= 20},
            {"msg_ocr",      g_ram_gb >= 4  ? "✅ LightOnOCR ready" : "❌ Need 4GB+ RAM for OCR"},
            {"msg_llm",      file_exists(g_llm_model) ? "✅ Agents A1 ready" : "⚠️ Download Agents A1 (34GB)"},
            {"msg_timelens", g_ram_gb >= 20 ? "✅ TimeLens2-8B ready" : "⚠️ Need 20GB+ RAM for TimeLens"},
        };
        res.set_content(info.dump(), "application/json");
    });

    // ── API: Upload file → returns saved path ──
    svr.Post("/api/upload", [](const httplib::Request& req, httplib::Response& res) {
        try {
            if (!req.form.has_file("file")) { res.set_content(R"({"error":"no file"})", "application/json"); return; }
            auto file = req.form.get_file("file");
            std::string ext = ".bin";
            auto dot = file.filename.find_last_of('.');
            if (dot != std::string::npos) ext = file.filename.substr(dot);

            std::string dest = g_uploads_dir + "/" + std::to_string(time(nullptr)) + ext;
            std::ofstream f(dest, std::ios::binary);
            f.write(file.content.data(), file.content.size());
            f.close();

            json r = {{"path", dest}, {"name", file.filename}, {"size", std::to_string(file.content.size())}};
            res.set_content(r.dump(), "application/json");
        } catch (const std::exception& e) {
            res.set_content(json({{"error", e.what()}}).dump(), "application/json");
        }
    });

    // ── API: OCR ──
    svr.Post("/api/ocr", [](const httplib::Request& req, httplib::Response& res) {
        auto cli = make_client(9101);
        auto result = cli.Post("/", req.body, "application/json");
        if (result) res.set_content(result->body, "application/json");
        else res.set_content(R"({"error":"OCR worker unavailable"})", "application/json");
    });

    // ── API: TimeLens ──
    svr.Post("/api/timelens", [](const httplib::Request& req, httplib::Response& res) {
        if (!is_alive(g_timelens_pid)) {
            res.set_content(R"({"error":"TimeLens worker not running"})", "application/json");
            return;
        }
        auto cli = make_client(9102);
        auto result = cli.Post("/", req.body, "application/json");
        if (result) res.set_content(result->body, "application/json");
        else res.set_content(R"({"error":"TimeLens worker unavailable"})", "application/json");
    });

    // ── API: LLM Chat ──
    svr.Post("/api/llm/chat", [](const httplib::Request& req, httplib::Response& res) {
        if (!is_alive(g_llama_pid)) {
            res.set_content(R"({"error":"LLM not running"})", "application/json");
            return;
        }
        auto cli = make_client(8081);
        auto result = cli.Post("/v1/chat/completions", req.body, "application/json");
        if (result) res.set_content(result->body, "application/json");
        else res.set_content(R"({"error":"LLM unavailable"})", "application/json");
    });

    // ── API: LLM Health ──
    svr.Get("/api/llm/health", [](const httplib::Request&, httplib::Response& res) {
        if (!is_alive(g_llama_pid)) { res.set_content(R"({"alive":false})", "application/json"); return; }
        auto cli = make_client(8081);
        auto result = cli.Get("/health");
        if (result) res.set_content(result->body, "application/json");
        else res.set_content(R"({"alive":false})", "application/json");
    });

    // ── API: PDF Extract (subprocess Python) ──
    svr.Post("/api/extract-pdf", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto data = json::parse(req.body);
            std::string pdf_path = data["path"].get<std::string>();
            std::string py_code = "import json, fitz; doc=fitz.open('" + pdf_path + "'); "
                "text='\\n'.join([f'=== PAGE {i+1}/{doc.page_count} ===\\n{p.get_text()}' for i,p in enumerate(doc)]); "
                "doc.close(); print(json.dumps({'text':text,'pages':doc.page_count}))";
            std::string out = run_python(py_code);
            if (!out.empty()) { res.set_content(out, "application/json"); return; }
            res.set_content(R"({"error":"PDF extraction failed"})", "application/json");
        } catch (...) { res.set_content(R"({"error":"bad request"})", "application/json"); }
    });

    // ── API: Sessions ──
    svr.Get("/api/sessions", [](const httplib::Request&, httplib::Response& res) {
        res.set_content(load_sessions().dump(), "application/json");
    });

    svr.Post("/api/sessions", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto data = json::parse(req.body);
            auto sessions = load_sessions();
            sessions.insert(sessions.begin(), data);
            save_sessions(sessions);
            res.set_content(data.dump(), "application/json");
        } catch (...) { res.status = 400; res.set_content(R"({"error":"bad json"})", "application/json"); }
    });

    svr.Get(R"(/api/sessions/(.+))", [](const httplib::Request& req, httplib::Response& res) {
        std::string sid = req.matches[1];
        std::string path = g_sessions_dir + "/" + sid + ".json";
        if (file_exists(path)) res.set_content(slurp(path), "application/json");
        else { res.status = 404; res.set_content("{}", "application/json"); }
    });

    svr.Delete(R"(/api/sessions/(.+))", [](const httplib::Request& req, httplib::Response& res) {
        std::string sid = req.matches[1];
        std::string path = g_sessions_dir + "/" + sid + ".json";
        if (file_exists(path)) std::remove(path.c_str());
        auto sessions = load_sessions();
        sessions.erase(std::remove_if(sessions.begin(), sessions.end(),
            [&](const json& s) { return s["id"] == sid; }), sessions.end());
        save_sessions(sessions);
        res.set_content(sessions.dump(), "application/json");
    });

    svr.Post(R"(/api/sessions/(.+)/chat)", [](const httplib::Request& req, httplib::Response& res) {
        std::string sid = req.matches[1];
        std::string path = g_sessions_dir + "/" + sid + ".json";
        if (file_exists(path)) {
            try {
                auto session = json::parse(slurp(path));
                auto body = json::parse(req.body);
                session["chat"] = body["chat"];
                write_file(path, session.dump(2));
            } catch (...) {}
        }
        res.set_content(R"({"ok":true})", "application/json");
    });

    // ═══ Start ═══
    std::cout << "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" << std::endl;
    std::cout << "  RTIP v2 — C++ Server" << std::endl;
    std::cout << "  RAM: " << g_ram_gb << "GB" << std::endl;
    std::cout << "  OCR: " << (is_alive(g_ocr_pid) ? "✅" : "❌") << std::endl;
    std::cout << "  LLM: " << (is_alive(g_llama_pid) ? "✅" : "❌") << std::endl;
    std::cout << "  TimeLens: " << (is_alive(g_timelens_pid) ? "✅" : "❌") << std::endl;
    std::cout << "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" << std::endl;
    std::cout << "  Open: http://127.0.0.1:8080" << std::endl;
    std::cout << "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" << std::endl;

    svr.listen("127.0.0.1", 8080);

    shutdown(0);
    return 0;
}
