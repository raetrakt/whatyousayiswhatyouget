What You Say Is What You Get?
Towards a deliberate use of large language models for custom graphic design tools

Fabian Pitzer
Master of Arts in Design
Visual Communication

Mentor
Urs Hofer

Zurich University of the Arts
June 2026


If you want to modify tools from the tools page, you will need [Node.js](https://nodejs.org/).

Then download or clone this repository to your computer.

Open a terminal in the project folder (in VS Code: Terminal → New Terminal).

Type `npm install` and press Enter — this downloads the project's dependencies (only needed once).

To run the tools locally:
Type `npm run dev` and press Enter — this starts a local web server.
Open your browser and go to http://localhost:5173/tools/.
The tools will reload automatically whenever you save a file, so you can see changes right away.

Each tool lives in its own folder inside tools (e.g. sand).
Start by editing the `.js` file inside the folder of the tool you want to modify.

When you're done, run `npm run build` to create a production-ready version of the site in a `dist/` folder.


Written thesis and diagrams © Fabian Pitzer, licensed under CC BY-NC 4.0.
Graphic design works on the dictionary page and figures in the thesis are shown for educational purposes only. All rights belong to the authors.
All code licensed under the MIT License, unless otherwise stated.