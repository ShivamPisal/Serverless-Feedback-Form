import { useState } from "react";

const apiUrl = import.meta.env.VITE_FEEDBACK_API_URL?.trim() || "";
const isDemoMode = !apiUrl;

const readFileAsBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result.split(",").pop() : "";
      resolve(result);
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });

function App() {
  const [formState, setFormState] = useState({
    name: "",
    email: "",
    message: "",
  });
  const [file, setFile] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalMessage, setModalMessage] = useState("");

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormState((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const resetForm = () => {
    setFormState({
      name: "",
      email: "",
      message: "",
    });
    setFile(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      if (isDemoMode) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        setModalMessage("Demo mode: feedback submission UI preview completed successfully.");
        resetForm();
        return;
      }

      const payload = {
        ...formState,
        file_base64: file ? await readFileAsBase64(file) : null,
      };

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Submission failed.");
      }

      setModalMessage(data.message || "Feedback submitted successfully!");
      resetForm();
    } catch (error) {
      setModalMessage(error instanceof Error ? error.message : "Submission failed. Please try again later.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="page-shell">
      <main className="card single-card">
        <section className="form-panel" id="feedback-form">
          <div className="form-panel-head">
            <div>
              <p className="form-kicker">Feedback</p>
              <h2>Get in touch</h2>
            </div>
            <p className="form-support">
              {isDemoMode ? "Live portfolio preview. Submission is shown in demo mode." : "Complete the form and we will review it."}
            </p>
          </div>

          <form className="feedback-form" onSubmit={handleSubmit}>
            <label>
              <span>Name</span>
              <input
                type="text"
                name="name"
                value={formState.name}
                onChange={handleChange}
                placeholder="Your name"
                required
              />
            </label>

            <label>
              <span>Email</span>
              <input
                type="email"
                name="email"
                value={formState.email}
                onChange={handleChange}
                placeholder="you@example.com"
                required
              />
            </label>

            <label className="full-width">
              <span>Message</span>
              <textarea
                name="message"
                value={formState.message}
                onChange={handleChange}
                placeholder="Tell us what worked, what didn't, and what would help."
                rows="6"
                required
              />
            </label>

            <label className="full-width file-field">
              <span>PDF attachment</span>
              <input
                type="file"
                accept="application/pdf"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              <small>{file ? `Selected: ${file.name}` : "Optional. Product brief, screenshots, or supporting notes."}</small>
            </label>

            <button type="submit" disabled={isSubmitting} className="submit-button">
              {isSubmitting ? "Submitting..." : "Submit feedback"}
            </button>
          </form>

        </section>
      </main>

      {modalMessage ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setModalMessage("")}>
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-result"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="feedback-result">Submission status</h2>
            <p>{modalMessage}</p>
            <button type="button" onClick={() => setModalMessage("")}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
