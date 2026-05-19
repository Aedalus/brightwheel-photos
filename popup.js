console.log("Content script loaded");

// Reference Chrome Extension Tutorial
// https://dev.to/andreygermanov/create-a-google-chrome-extension-part-1-image-grabber-1foa

class BrightwheelLoader {
  tab = null;

  guardianID = null;
  students = null;
  studentID = null;
  startAt = null;
  endAt = null;

  domStudent = document.getElementById("student");
  domStartAt = document.getElementById("start-at");
  domEndAt = document.getElementById("end-at");
  domDateRangeWarning = document.getElementById("date-range-warning");
  domProgressPanel = document.querySelector(".progress-panel");
  domProgressStatus = document.getElementById("progress-status");
  domProgressCount = document.getElementById("progress-count");
  domProgressBar = document.getElementById("progress-bar");
  domGrabBtn = document.getElementById("grabBtn");

  constructor() {
    const startAt = new Date();
    startAt.setMonth(startAt.getMonth() - 3);

    this.startAt = startAt.toISOString();
    this.endAt = new Date().toISOString();
  }

  updateUI() {
    this.domStudent.innerHTML = "";
    for (const s of this.students) {
      const option = document.createElement("option");
      option.value = s.id;
      option.textContent = s.name;
      this.domStudent.appendChild(option);
    }

    this.domStartAt.valueAsDate = new Date(this.startAt);
    this.domEndAt.valueAsDate = new Date(this.endAt);
    this.updateDateRangeWarning();
    this.setProgress("Ready to export photos.", 0);
  }

  async init() {
    this.setBusy(true, "Connecting to Brightwheel...");
    await this.initTab();
    this.setProgress("Loading guardian account...");
    await this.initGuardianID();
    this.setProgress("Loading students...");
    await this.initStudents();

    // initialize listeners
    this.domStudent.addEventListener("change", (e) => {
      this.studentID = e.target.value;
      console.log(this.studentID);
    });
    this.domStartAt.addEventListener("change", (e) => {
      this.startAt = e.target.value;
      this.updateDateRangeWarning();
      console.log(this.startAt);
    });
    this.domEndAt.addEventListener("change", (e) => {
      this.endAt = e.target.value;
      this.updateDateRangeWarning();
      console.log(this.endAt);
    });

    this.domGrabBtn.addEventListener("click", this.submit.bind(this));
    this.setBusy(false);
  }

  async submit() {
    try {
      this.setBusy(true, "Searching for photos...");
      console.log({
        studentID: this.studentID,
        startAt: this.startAt,
        endAt: this.endAt,
      });
      const images = await this.paginateImages();
      const downloadableImages = images.filter((x) => x?.media?.image_url);
      console.log({ images, downloadableImages });

      if (downloadableImages.length === 0) {
        this.setProgress("No photos found for this date range.", 0);
        return;
      }

      await this.createZip(
        downloadableImages.map((x) => ({
          url: x.media.image_url,
          name: x.created_at + "." + x.object_id,
        }))
      );
      this.setProgress(
        `Export complete. ${downloadableImages.length} photos downloaded.`,
        100
      );
    } catch (error) {
      console.error(error);
      this.setProgress(
        error.message || "Something went wrong while exporting photos.",
        100,
        true
      );
    } finally {
      this.setBusy(false);
    }
  }

  async createZip(images) {
    // {url, name}[]
    const zip = new JSZip();
    for (const [index, img] of images.entries()) {
      this.setProgress(
        `Downloading photo ${index + 1} of ${images.length}...`,
        this.mapProgress(index, images.length, 0, 90)
      );
      const response = await fetch(img.url);
      if (!response.ok) {
        throw new Error(`Could not download photo ${index + 1}.`);
      }
      const blob = await response.blob();
      const [type, extension] = blob.type.split("/");
      const name = `${img.name}.${extension}`;
      console.log("Adding", name);
      zip.file(name, blob);
    }

    this.setProgress("Building ZIP file...", 90);
    const z = await zip.generateAsync({ type: "blob" }, (metadata) => {
      this.setProgress(
        `Compressing files... ${Math.round(metadata.percent)}%`,
        90 + metadata.percent * 0.1
      );
    });

    const link = document.createElement("a");
    link.href = URL.createObjectURL(z);
    link.download = "images.zip";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  setBusy(isBusy, label) {
    this.domGrabBtn.disabled = isBusy;
    this.domStudent.disabled = isBusy;
    this.domStartAt.disabled = isBusy;
    this.domEndAt.disabled = isBusy;
    if (isBusy && label) {
      this.setProgress(label);
    }
  }

  setProgress(message, percent = null, isError = false) {
    this.domProgressStatus.textContent = message;
    this.domProgressPanel.classList.toggle("is-error", isError);

    if (percent === null) {
      this.domProgressCount.textContent = "...";
      this.domProgressBar.classList.add("is-active");
      this.domProgressBar.style.width = "";
      return;
    }

    const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
    this.domProgressBar.classList.remove("is-active");
    this.domProgressBar.style.width = `${safePercent}%`;
    this.domProgressCount.textContent = `${safePercent}%`;
  }

  mapProgress(index, total, start, range) {
    if (total === 0) return start;
    return start + (index / total) * range;
  }

  updateDateRangeWarning() {
    const startDate = this.parseDateInput(this.domStartAt.value || this.startAt);
    const endDate = this.parseDateInput(this.domEndAt.value || this.endAt);

    if (!startDate || !endDate) {
      this.domDateRangeWarning.hidden = true;
      return;
    }

    const days = Math.abs(endDate - startDate) / (1000 * 60 * 60 * 24);
    this.domDateRangeWarning.hidden = days <= 90;
  }

  parseDateInput(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  async initTab() {
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    this.tab = tab;
  }

  async initGuardianID() {
    const result = await chrome.scripting.executeScript({
      target: { tabId: this.tab.id },
      function: () => {
        return fetch("https://schools.mybrightwheel.com/api/v1/users/me").then(
          (result) => result.json()
        );
      },
    });
    const guardianID = result?.[0]?.result?.object_id;
    if (!guardianID) {
      throw new Error("Open a Brightwheel page, then reopen this exporter.");
    }
    this.guardianID = guardianID;
  }

  async initStudents() {
    const studentResult = await chrome.scripting.executeScript({
      target: { tabId: this.tab.id },
      args: [this.guardianID],
      function: (guardianID) => {
        return fetch(
          `https://schools.mybrightwheel.com/api/v1/guardians/${guardianID}/students`
        ).then((result) => result.json());
      },
    });
    const students = studentResult?.[0]?.result?.students;
    if (!Array.isArray(students)) {
      throw new Error("Could not load students from Brightwheel.");
    }
    this.students = students
      .filter((x) => x.student?.enrollment_status === "Active") // ToDo - Old students?
      .map((x) => ({
        id: x.student.object_id,
        name: x.student.first_name + " " + x.student.last_name,
      }));
    if (this.students.length === 0) {
      throw new Error("No active students were found for this guardian.");
    }
    this.studentID = this.students[0].id;
  }

  async paginateImages() {
    let page = 0;
    let images = [];
    let newImages = [];
    do {
      this.setProgress(`Checking Brightwheel page ${page + 1}...`);
      newImages = await this.getImages(page);
      images = images.concat(newImages);
      this.setProgress(`Found ${images.length} photos so far...`);
      page++;
    } while (newImages.length > 0);
    this.setProgress(`Found ${images.length} photos. Preparing downloads...`, 0);
    return images;
  }

  async getImages(page = 0) {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    await sleep(1000);
    const pictureLinks = await chrome.scripting.executeScript({
      target: { tabId: this.tab.id },
      args: [
        this.studentID,
        page,
        new Date(this.startAt).toISOString(),
        new Date(this.endAt).toISOString(),
      ],
      function: (studentID, page, startDate, endDate) => {
        const url = `https://schools.mybrightwheel.com/api/v1/students/${studentID}/activities?page=${page}&page_size=50&start_date=${startDate}&end_date=${endDate}&action_type=ac_photo&include_parent_actions=true`;
        return fetch(url).then((result) => result.json());
      },
    });
    console.log("Getting Images");
    console.log(pictureLinks.length);
    const images = pictureLinks?.[0]?.result;
    const activities = images?.activities; // media.image_url, created_at
    if (!Array.isArray(activities)) {
      throw new Error("Could not load photos from Brightwheel.");
    }
    return activities;
  }
}

// Init

const run = async () => {
  const bw = new BrightwheelLoader();
  try {
    await bw.init();
    bw.updateUI();
  } catch (error) {
    console.error(error);
    bw.setProgress(
      error.message || "Open Brightwheel in this tab, then reopen this exporter.",
      0,
      true
    );
    bw.domGrabBtn.disabled = true;
    bw.domStudent.disabled = true;
    bw.domStartAt.disabled = true;
    bw.domEndAt.disabled = true;
  }
};
run();
if (chrome.extension?.getBackgroundPage) {
  chrome.extension.getBackgroundPage().console.log("Content script loaded");
}
