async function loadProject(projectId) {
    let fetchURL;

    const urlParams = new URLSearchParams(window.location.search);
    const templateParam = urlParams.get('template');

    if (projectId) {
        fetchURL = `/project/${projectId}`;
    } else if (templateParam) {
        fetchURL = `/data/examples/${templateParam}.json`;
    } else {
        return {}; // No need to fetch data, return an empty object
    }

    try {
        const response = await fetch(fetchURL, {
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Network response was not ok');
        }

        const data = await response.json();
        return data;
    } catch (error) {
        console.error('There was a problem with the fetch operation:', error);
        return {}; // Return an empty object if there's an error
    }
}
