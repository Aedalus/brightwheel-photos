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

  domGuardianID = document.getElementById("guardian-id");
  domStudent = document.getElementById("student");
  domStartAt = document.getElementById("start-at");
  domEndAt = document.getElementById("end-at");

  constructor() {
    const startAt = new Date();
    startAt.setMonth(startAt.getMonth() - 3);

    this.startAt = startAt.toISOString();
    this.endAt = new Date().toISOString();
  }

  updateUI() {
    this.domGuardianID.textContent = this.guardianID;

    this.domStudent.innerHTML = "";
    for (const s of this.students) {
      const option = document.createElement("option");
      option.value = s.id;
      option.textContent = s.name;
      this.domStudent.appendChild(option);
    }

    this.domStartAt.valueAsDate = new Date(this.startAt);
    this.domEndAt.valueAsDate = new Date(this.endAt);
  }

  async init() {
    await this.initTab();
    await this.initGuardianID();
    await this.initStudents();

    // initialize listeners
    this.domStudent.addEventListener("change", (e) => {
      this.studentID = e.target.value;
      console.log(this.studentID);
    });
    this.domStartAt.addEventListener("change", (e) => {
      this.startAt = e.target.value;
      console.log(this.startAt);
    });
    this.domEndAt.addEventListener("change", (e) => {
      this.endAt = e.target.value;
      console.log(this.endAt);
    });

    const grabBtn = document.getElementById("grabBtn");
    grabBtn.addEventListener("click", this.submit.bind(this));
  }

  async submit() {
    console.log({
      studentID: this.studentID,
      startAt: this.startAt,
      endAt: this.endAt,
    });
    const images = await this.paginateImages();
    console.log({ images });

    await this.createZip(
      images.map((x) => ({
        url: x.media.image_url,
        name: x.created_at + "." + x.object_id,
      }))
    );
  }

  async createZip(images) {
    // {url, name}[]
    const zip = new JSZip();
    for (const img of images) {
      const response = await fetch(img.url);
      const blob = await response.blob();
      const [type, extension] = blob.type.split("/");
      const name = `${img.name}.${extension}`;
      console.log("Adding", name);
      zip.file(name, blob);
    }

    const z = await zip.generateAsync({ type: "blob" });

    const link = document.createElement("a");
    link.href = URL.createObjectURL(z);
    link.download = "images.zip";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  async initTab() {
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    this.tab = tab;
  }

  async initGuardianID() {
    let result = await chrome.scripting.executeScript({
      target: { tabId: this.tab.id },
      function: () => {
        return fetch("https://schools.mybrightwheel.com/api/v1/users/me").then(
          (result) => result.json()
        );
      },
    });
    const guardianID = result[0].result.object_id;
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
    const students = studentResult[0].result.students;
    this.students = students
      .filter((x) => x.student.enrollment_status === "Active") // ToDo - Old students?
      .map((x) => ({
        id: x.student.object_id,
        name: x.student.first_name + " " + x.student.last_name,
      }));
    this.studentID = this.students[0].id;
  }

  async paginateImages() {
    let page = 0;
    let images = [];
    let newImages = [];
    do {
      newImages = await this.getImages(page);
      images = images.concat(newImages);
      page++;
    } while (newImages.length > 0);
    return images;
  }

  async getImages(page = 0) {
    const pictureLinks = await chrome.scripting.executeScript({
      target: { tabId: this.tab.id },
      args: [
        this.studentID,
        page,
        new Date(this.startAt).toISOString(),
        new Date(this.endAt).toISOString(),
      ],
      function: (studentID, page, startDate, endDate) => {
        const url = `https://schools.mybrightwheel.com/api/v1/students/${studentID}/activities?page=${page}&page_size=200&start_date=${startDate}&end_date=${endDate}&action_type=ac_photo&include_parent_actions=true`;
        return fetch(url).then((result) => result.json());
      },
    });
    const images = pictureLinks[0].result;
    const activities = images.activities; // media.image_url, created_at
    return activities;
  }
}

// Init

const run = async () => {
  const bw = new BrightwheelLoader();
  await bw.init();
  bw.updateUI();
};
run();
