function filter(letter) {
    const sections = document.querySelectorAll('.section');
    const activeLetter = document.querySelector('.letter.active');

    if (activeLetter && activeLetter.innerText === letter) {
        // If the clicked letter is already active, show all sections
        sections.forEach(section => {
            section.style.display = 'block';
        });
        // Remove active class from all letters
        const letters = document.querySelectorAll('.letter');
        letters.forEach(l => {
            l.classList.remove('active');
        });
    } else {
        // Filter sections by the clicked letter
        sections.forEach(section => {
            if (section.id === letter) {
                section.style.display = 'block';
            } else {
                section.style.display = 'none';
            }
        });
        // Remove active class from all letters
        const letters = document.querySelectorAll('.letter');
        letters.forEach(l => {
            l.classList.remove('active');
        });
        // Add active class to the clicked letter
        const clickedLetter = document.querySelector('.letter[data-letter="' + letter + '"]');
        clickedLetter.classList.add('active');
    }
}
// Function to filter terms based on user input
function filterTerms(inputValue) {
    // Convert input value to lowercase for case-insensitive filtering
    const searchTerm = inputValue.toLowerCase();
    const items = document.querySelectorAll('.item');
    const sections = document.querySelectorAll('.section');
    items.forEach(item => {
        const title = item.dataset.title.toLowerCase(); // Get the title from the data-title attribute
        // Check if the title contains the search term
        if (title.includes(searchTerm)) {
            item.style.display = 'block';
            const sectionId = `${item.closest('.section').id}`;
            document.getElementById(sectionId).style.display = 'block'; // Show section
        } else {
            item.style.display = 'none';
        }
    });
    // Hide sections with no visible items
    sections.forEach(section => {
        const visibleItems = section.querySelectorAll('.item[style="display: block;"]');
        if (visibleItems.length === 0) {
            section.style.display = 'none'; // Hide section
        } else {
            section.style.display = 'block';
        }
    });
}